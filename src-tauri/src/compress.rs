//! Make PDFs smaller: re-encode photos at a sensible resolution and JPEG
//! quality, drop unused objects, write compact object streams. Nothing else
//! changes (text, vectors, forms stay as they are), and the result is never
//! larger than the input: when it would be, the original is kept.
//!
//! Only image kinds that can be re-encoded without changing how they look
//! are touched:
//! - RGB or greyscale (Device or ICC-profile colour, the profile is kept),
//!   8 or 16 bits, stored as JPEG (DCT) or Flate - Flate with or without a PNG
//!   predictor - are re-encoded as JPEG;
//! - palette (Indexed) images with many colours (photos saved as palettes) are
//!   expanded and re-encoded; few-colour ones (logos, charts) are left alone,
//!   JPEG would blur their edges;
//! - CMYK Flate images are only shrunk when oversized and stay lossless CMYK:
//!   converting them to RGB would change their colours. CMYK JPEGs stay as they are.
//! Masks, Decode arrays, 1-bit, JPX/CCITT/JBIG2 images are left alone.
//! Identical images (the same logo on every page) are stored once. Every image's
//! size is checked before it is decoded, so a hostile PDF can't make this
//! allocate gigabytes.

use image::{
    codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageBuffer, Luma, Rgb,
};
use lopdf::{Document, LoadOptions, Object, Stream};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    /// Barely visible: big images only, high quality.
    Light,
    /// Good for email and sharing.
    Balanced,
    /// Smallest: screen reading only.
    Strong,
}

impl Preset {
    /// Longest side in pixels, JPEG quality.
    fn params(self) -> (u32, u8) {
        match self {
            Preset::Light => (2600, 82),
            Preset::Balanced => (1800, 70),
            Preset::Strong => (1200, 55),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Outcome {
    pub before: u64,
    pub after: u64,
    pub images_seen: usize,
    pub images_recompressed: usize,
    /// True when compressing didn't help and the original was kept.
    pub kept_original: bool,
}

/// Images over this many pixels are skipped (decompression-bomb guard).
const MAX_PIXELS: u64 = 80_000_000;

/// Largest decompressed stream accepted (an 80-megapixel RGB image is 240 MB).
const MAX_STREAM_BYTES: usize = 300 * 1024 * 1024;

pub fn compress(
    input: &[u8],
    preset: Preset,
    password: Option<&str>,
) -> Result<(Vec<u8>, Outcome), String> {
    let options = LoadOptions {
        password: password.filter(|p| !p.is_empty()).map(str::to_string),
        // Per-stream cap, so a hostile PDF can't inflate a stream to gigabytes.
        max_decompressed_size: Some(MAX_STREAM_BYTES),
        ..LoadOptions::default()
    };
    let mut doc = Document::load_mem_with_options(input, options)
        .map_err(|e| format!("can't read this PDF: {e}"))?;
    if doc.is_encrypted() {
        return Err("This PDF is password-protected; open it with its password first.".into());
    }

    let (max_side, quality) = preset.params();
    let mut seen = 0;
    let mut done = 0;
    let ids: Vec<_> = doc.objects.keys().copied().collect();
    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get(&id) else {
            continue;
        };
        if !is_image(stream) {
            continue;
        }
        seen += 1;
        let kind = classify(&doc, stream);
        let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) else {
            continue;
        };
        match recompress(stream, kind, max_side, quality) {
            Ok(true) => done += 1,
            Ok(false) => {}
            Err(e) => tracing::debug!("image {id:?} left as is: {e}"),
        }
    }
    dedupe_images(&mut doc);

    doc.delete_zero_length_streams();
    doc.prune_objects();
    doc.compress();
    let mut out = Vec::with_capacity(input.len() / 2);
    doc.save_modern(&mut out)
        .map_err(|e| format!("can't write the smaller PDF: {e}"))?;

    let before = input.len() as u64;
    if out.len() as u64 >= before {
        return Ok((
            input.to_vec(),
            Outcome {
                before,
                after: before,
                images_seen: seen,
                images_recompressed: done,
                kept_original: true,
            },
        ));
    }
    let after = out.len() as u64;
    Ok((
        out,
        Outcome {
            before,
            after,
            images_seen: seen,
            images_recompressed: done,
            kept_original: false,
        },
    ))
}

fn name<'a>(s: &'a Stream, key: &[u8]) -> Option<&'a [u8]> {
    s.dict.get(key).ok().and_then(|o| o.as_name().ok())
}

fn int(s: &Stream, key: &[u8]) -> Option<i64> {
    s.dict.get(key).ok().and_then(|o| o.as_i64().ok())
}

fn is_image(s: &Stream) -> bool {
    name(s, b"Subtype") == Some(b"Image")
}

/// What an image's colour space is, as far as re-encoding cares.
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    /// 1 (grey) or 3 (RGB) channels; `keep_cs` is the original colour space when
    /// it carries a profile (ICCBased) and must stay on the re-encoded image.
    Plain { channels: u8, keep_cs: Option<Object> },
    /// Palette: base RGB/grey colours, `hival + 1` entries of `base` channels each.
    Indexed { base: u8, entries: usize, lut: Vec<u8> },
    /// 4-channel CMYK (Device or ICC): shrink only, stays lossless.
    Cmyk,
    Other,
}

fn resolve<'a>(doc: &'a Document, o: &'a Object) -> &'a Object {
    match o {
        Object::Reference(id) => doc.get_object(*id).unwrap_or(o),
        _ => o,
    }
}

/// Channels of a colour space that isn't Indexed: Device*, or ICCBased's /N.
fn base_channels(doc: &Document, cs: &Object) -> Option<u8> {
    match resolve(doc, cs) {
        Object::Name(n) => match n.as_slice() {
            b"DeviceGray" => Some(1),
            b"DeviceRGB" => Some(3),
            b"DeviceCMYK" => Some(4),
            _ => None,
        },
        Object::Array(a) if a.len() == 2 && a[0].as_name().ok() == Some(b"ICCBased") => {
            match resolve(doc, &a[1]) {
                Object::Stream(icc) => icc.dict.get(b"N").ok()?.as_i64().ok().map(|n| n as u8),
                _ => None,
            }
        }
        _ => None,
    }
}

fn classify(doc: &Document, s: &Stream) -> Kind {
    let Ok(cs) = s.dict.get(b"ColorSpace") else {
        return Kind::Other;
    };
    let cs = resolve(doc, cs);
    if let Object::Array(a) = cs {
        if a.len() == 4 && a[0].as_name().ok() == Some(b"Indexed") {
            let Some(base) = base_channels(doc, &a[1]).filter(|&b| b == 1 || b == 3) else {
                return Kind::Other;
            };
            let Ok(hival) = resolve(doc, &a[2]).as_i64() else {
                return Kind::Other;
            };
            let lut = match resolve(doc, &a[3]) {
                Object::String(b, _) => b.clone(),
                Object::Stream(st) => st.decompressed_content().unwrap_or_else(|_| st.content.clone()),
                _ => return Kind::Other,
            };
            if !(0..=255).contains(&hival) || lut.len() < (hival as usize + 1) * base as usize {
                return Kind::Other;
            }
            return Kind::Indexed { base, entries: hival as usize + 1, lut };
        }
    }
    match base_channels(doc, cs) {
        Some(c @ (1 | 3)) => Kind::Plain {
            channels: c,
            keep_cs: matches!(cs, Object::Array(_)).then(|| s.dict.get(b"ColorSpace").cloned().ok()).flatten(),
        },
        Some(4) => Kind::Cmyk,
        _ => Kind::Other,
    }
}

/// Undo PNG row predictors (DecodeParms /Predictor 10-15): each row starts
/// with a filter-type byte. `bpp` = bytes per pixel, `row` = bytes per row.
fn unpredict_png(data: &[u8], row: usize, bpp: usize, rows: usize) -> Result<Vec<u8>, String> {
    let stride = row + 1;
    if data.len() < stride * rows {
        return Err("predicted image data is short".into());
    }
    let mut out = vec![0u8; row * rows];
    for r in 0..rows {
        let ft = data[r * stride];
        let src = &data[r * stride + 1..r * stride + 1 + row];
        for i in 0..row {
            let a = if i >= bpp { out[r * row + i - bpp] as i32 } else { 0 };
            let b = if r > 0 { out[(r - 1) * row + i] as i32 } else { 0 };
            let c = if r > 0 && i >= bpp { out[(r - 1) * row + i - bpp] as i32 } else { 0 };
            let pred = match ft {
                0 => 0,
                1 => a,
                2 => b,
                3 => (a + b) / 2,
                4 => {
                    let p = a + b - c;
                    let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                    if pa <= pb && pa <= pc {
                        a
                    } else if pb <= pc {
                        b
                    } else {
                        c
                    }
                }
                _ => return Err(format!("unknown PNG row filter {ft}")),
            };
            out[r * row + i] = (src[i] as i32 + pred) as u8;
        }
    }
    Ok(out)
}

/// A Flate (or unfiltered) image's samples, predictor undone, 16-bit cut to 8.
fn flate_samples(s: &mut Stream, w: u32, h: u32, channels: usize, filtered: bool) -> Result<Option<Vec<u8>>, String> {
    let bpc = int(s, b"BitsPerComponent").unwrap_or(0);
    if bpc != 8 && bpc != 16 {
        return Ok(None);
    }
    let bytes_per_sample = (bpc / 8) as usize;
    // Decode only the Flate layer (DecodeParms set aside), then undo the predictor here.
    let parms = s.dict.remove(b"DecodeParms");
    let raw = if filtered { s.decompressed_content() } else { Ok(s.content.clone()) };
    if let Some(p) = parms.clone() {
        s.dict.set("DecodeParms", p);
    }
    let raw = raw.map_err(|e| e.to_string())?;
    let row = w as usize * channels * bytes_per_sample;
    let raw = match parms.as_ref().map(|o| o.as_dict()) {
        None => raw,
        Some(Err(_)) => return Ok(None), // parameters as a reference or array: leave alone
        Some(Ok(p)) => {
            let pred = p.get(b"Predictor").ok().and_then(|o| o.as_i64().ok()).unwrap_or(1);
            let colors = p.get(b"Colors").ok().and_then(|o| o.as_i64().ok()).unwrap_or(1);
            let pbpc = p.get(b"BitsPerComponent").ok().and_then(|o| o.as_i64().ok()).unwrap_or(8);
            let cols = p.get(b"Columns").ok().and_then(|o| o.as_i64().ok()).unwrap_or(1);
            if pred == 1 {
                raw
            } else if (10..=15).contains(&pred) && colors as usize == channels && pbpc == bpc && cols as u32 == w {
                unpredict_png(&raw, row, channels * bytes_per_sample, h as usize)?
            } else {
                return Ok(None); // TIFF predictor or odd parameters: leave alone
            }
        }
    };
    if raw.len() < row * h as usize {
        return Ok(None);
    }
    let raw = &raw[..row * h as usize];
    Ok(Some(if bytes_per_sample == 2 {
        raw.chunks_exact(2).map(|c| c[0]).collect()
    } else {
        raw.to_vec()
    }))
}

/// Palettes with this many colours or more are treated as photos.
const PHOTO_PALETTE: usize = 128;

/// Re-encode one image stream in place. Ok(false) = skipped or not smaller.
fn recompress(s: &mut Stream, kind: Kind, max_side: u32, quality: u8) -> Result<bool, String> {
    // Leave masks and anything with transparency rules or decode tweaks.
    if s.dict.get(b"ImageMask").ok().and_then(|o| o.as_bool().ok()) == Some(true)
        || s.dict.has(b"Mask")
        || s.dict.has(b"Decode")
        || s.dict.has(b"SMaskInData")
    {
        return Ok(false);
    }
    let w = int(s, b"Width").ok_or("no width")?;
    let h = int(s, b"Height").ok_or("no height")?;
    if w <= 0 || h <= 0 || (w as u64) * (h as u64) > MAX_PIXELS {
        return Ok(false);
    }
    let (w, h) = (w as u32, h as u32);
    let filters: Vec<Vec<u8>> = s
        .filters()
        .map(|f| f.iter().map(|x| x.to_vec()).collect())
        .unwrap_or_default();
    let fl: Vec<&[u8]> = filters.iter().map(Vec::as_slice).collect();
    let flate = match fl.as_slice() {
        [b"FlateDecode"] => Some(true),
        [] => Some(false),
        _ => None,
    };

    match kind {
        Kind::Other => Ok(false),
        Kind::Cmyk => {
            // Shrink oversized CMYK Flate images, losslessly; never convert colours.
            let Some(filtered) = flate else { return Ok(false) };
            if w.max(h) <= max_side {
                return Ok(false);
            }
            let Some(px) = flate_samples(s, w, h, 4, filtered)? else { return Ok(false) };
            let (nw, nh) = scaled(w, h, max_side);
            let small = resize_channels(&px, w, h, 4, nw, nh);
            s.dict.remove(b"DecodeParms");
            s.dict.remove(b"Filter");
            s.dict.set("Width", Object::Integer(nw as i64));
            s.dict.set("Height", Object::Integer(nh as i64));
            s.dict.set("BitsPerComponent", Object::Integer(8));
            s.set_plain_content(small);
            s.compress().map_err(|e| e.to_string())?;
            Ok(true)
        }
        Kind::Indexed { base, entries, lut } => {
            let Some(filtered) = flate else { return Ok(false) };
            if int(s, b"BitsPerComponent") != Some(8) || entries < PHOTO_PALETTE {
                return Ok(false);
            }
            let Some(idx) = flate_samples(s, w, h, 1, filtered)? else { return Ok(false) };
            let b = base as usize;
            let mut px = Vec::with_capacity(idx.len() * b);
            for &i in &idx {
                let at = i as usize * b;
                px.extend_from_slice(lut.get(at..at + b).ok_or("palette index out of range")?);
            }
            let img = to_image(px, w, h, base)?;
            encode_jpeg(s, img, base, None, max_side, quality)
        }
        Kind::Plain { channels, keep_cs } => {
            let img = match flate {
                None if fl.as_slice() == [b"DCTDecode".as_slice()] => {
                    // Small JPEGs are already as good as they get.
                    if s.content.len() < 60_000 {
                        return Ok(false);
                    }
                    image::load_from_memory_with_format(&s.content, image::ImageFormat::Jpeg)
                        .map_err(|e| e.to_string())?
                }
                None => return Ok(false), // JPX, CCITT, JBIG2, chains: leave alone
                Some(filtered) => {
                    let Some(px) = flate_samples(s, w, h, channels as usize, filtered)? else {
                        return Ok(false);
                    };
                    to_image(px, w, h, channels)?
                }
            };
            encode_jpeg(s, img, channels, keep_cs, max_side, quality)
        }
    }
}

fn scaled(w: u32, h: u32, max_side: u32) -> (u32, u32) {
    let scale = max_side as f64 / w.max(h) as f64;
    (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1))
}

/// Area-average resize of interleaved 8-bit samples (any channel count).
fn resize_channels(px: &[u8], w: u32, h: u32, ch: usize, nw: u32, nh: u32) -> Vec<u8> {
    let mut out = vec![0u8; nw as usize * nh as usize * ch];
    for y in 0..nh as usize {
        let y0 = y * h as usize / nh as usize;
        let y1 = ((y + 1) * h as usize / nh as usize).max(y0 + 1);
        for x in 0..nw as usize {
            let x0 = x * w as usize / nw as usize;
            let x1 = ((x + 1) * w as usize / nw as usize).max(x0 + 1);
            for c in 0..ch {
                let mut sum = 0u64;
                for yy in y0..y1 {
                    for xx in x0..x1 {
                        sum += px[(yy * w as usize + xx) * ch + c] as u64;
                    }
                }
                out[(y * nw as usize + x) * ch + c] = (sum / ((y1 - y0) * (x1 - x0)) as u64) as u8;
            }
        }
    }
    out
}

fn to_image(px: Vec<u8>, w: u32, h: u32, channels: u8) -> Result<DynamicImage, String> {
    Ok(if channels == 1 {
        DynamicImage::ImageLuma8(ImageBuffer::<Luma<u8>, _>::from_raw(w, h, px).ok_or("bad grey image")?)
    } else {
        DynamicImage::ImageRgb8(ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, px).ok_or("bad RGB image")?)
    })
}

/// JPEG-encode (after shrinking to `max_side`) and store if smaller.
/// `keep_cs`: an ICC colour space to keep instead of DeviceGray/DeviceRGB.
fn encode_jpeg(
    s: &mut Stream,
    img: DynamicImage,
    channels: u8,
    keep_cs: Option<Object>,
    max_side: u32,
    quality: u8,
) -> Result<bool, String> {
    let (w, h) = (img.width(), img.height());
    let img = if w.max(h) > max_side {
        let (nw, nh) = scaled(w, h, max_side);
        img.resize_exact(nw, nh, FilterType::Triangle)
    } else {
        img
    };
    let mut jpeg = Vec::new();
    let mut enc = JpegEncoder::new_with_quality(&mut jpeg, quality);
    let (nw, nh) = if channels == 1 {
        let g = img.to_luma8();
        enc.encode_image(&g).map_err(|e| e.to_string())?;
        (g.width(), g.height())
    } else {
        let c = img.to_rgb8();
        enc.encode_image(&c).map_err(|e| e.to_string())?;
        (c.width(), c.height())
    };
    if jpeg.len() >= s.content.len() {
        return Ok(false);
    }
    s.dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
    s.dict.remove(b"DecodeParms");
    s.dict.set("Width", Object::Integer(nw as i64));
    s.dict.set("Height", Object::Integer(nh as i64));
    s.dict.set("BitsPerComponent", Object::Integer(8));
    s.dict.set(
        "ColorSpace",
        keep_cs.unwrap_or_else(|| {
            Object::Name(if channels == 1 { b"DeviceGray".to_vec() } else { b"DeviceRGB".to_vec() })
        }),
    );
    s.set_content(jpeg);
    // Already compressed as JPEG; don't wrap it in Flate as well.
    s.allows_compression = false;
    Ok(true)
}

/// Identical image streams (same dictionary and bytes - e.g. a logo stored again on
/// every page) are kept once: references to the copies are pointed at the first.
fn dedupe_images(doc: &mut Document) {
    use std::collections::hash_map::DefaultHasher;
    use std::collections::HashMap;
    use std::hash::{Hash, Hasher};
    let mut first: HashMap<u64, Vec<lopdf::ObjectId>> = HashMap::new();
    let mut remap: HashMap<lopdf::ObjectId, lopdf::ObjectId> = HashMap::new();
    let mut ids: Vec<_> = doc.objects.keys().copied().collect();
    ids.sort();
    for id in ids {
        let Some(Object::Stream(s)) = doc.objects.get(&id) else { continue };
        if !is_image(s) {
            continue;
        }
        let mut hasher = DefaultHasher::new();
        s.content.hash(&mut hasher);
        format!("{:?}", s.dict).hash(&mut hasher);
        let key = hasher.finish();
        let same = first.get(&key).and_then(|cands| {
            cands.iter().copied().find(|c| match doc.objects.get(c) {
                Some(Object::Stream(o)) => o.content == s.content && format!("{:?}", o.dict) == format!("{:?}", s.dict),
                _ => false,
            })
        });
        match same {
            Some(keep) => {
                remap.insert(id, keep);
            }
            None => first.entry(key).or_default().push(id),
        }
    }
    if remap.is_empty() {
        return;
    }
    fn fix(o: &mut Object, remap: &std::collections::HashMap<lopdf::ObjectId, lopdf::ObjectId>) {
        match o {
            Object::Reference(r) => {
                if let Some(k) = remap.get(r) {
                    *r = *k;
                }
            }
            Object::Array(a) => a.iter_mut().for_each(|x| fix(x, remap)),
            Object::Dictionary(d) => d.iter_mut().for_each(|(_, x)| fix(x, remap)),
            Object::Stream(s) => s.dict.iter_mut().for_each(|(_, x)| fix(x, remap)),
            _ => {}
        }
    }
    for o in doc.objects.values_mut() {
        fix(o, &remap);
    }
    // the copies are now unreferenced; prune_objects() drops them
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Object, Stream};

    /// A one-page PDF showing a `w` x `h` noisy RGB photo stored as Flate.
    fn pdf_with_photo(w: u32, h: u32) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let mut px = Vec::with_capacity((w * h * 3) as usize);
        let mut seed: u32 = 12345;
        for y in 0..h {
            for x in 0..w {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let n = (seed >> 24) as u8 / 8;
                px.extend_from_slice(&[(x % 256) as u8 / 2 + n, (y % 256) as u8 / 2 + n, 128 + n]);
            }
        }
        let mut img = Stream::new(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
            },
            px,
        );
        img.compress().unwrap();
        let img_id = doc.add_object(img);
        let content = Stream::new(
            dictionary! {},
            b"q 500 0 0 400 50 200 cm /Im0 Do Q".to_vec(),
        );
        let content_id = doc.add_object(content);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Contents" => content_id,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 },
            ),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    #[test]
    fn photo_shrinks_and_page_survives() {
        let input = pdf_with_photo(3000, 2000);
        let (out, o) = compress(&input, Preset::Balanced, None).unwrap();
        assert!(!o.kept_original, "{o:?}");
        assert_eq!(o.images_recompressed, 1);
        assert!(o.after < o.before / 2, "{o:?}");
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        // The image is now a JPEG no larger than the preset's long side.
        let img = doc
            .objects
            .values()
            .find_map(|o| match o {
                Object::Stream(s) if is_image(s) => Some(s),
                _ => None,
            })
            .unwrap();
        assert_eq!(name(img, b"Filter"), Some(&b"DCTDecode"[..]));
        assert_eq!(int(img, b"Width"), Some(1800));
        assert_eq!(int(img, b"Height"), Some(1200));
    }

    #[test]
    fn stronger_presets_make_smaller_files() {
        let input = pdf_with_photo(2400, 1600);
        let light = compress(&input, Preset::Light, None).unwrap().1.after;
        let strong = compress(&input, Preset::Strong, None).unwrap().1.after;
        assert!(strong < light, "light {light}, strong {strong}");
    }

    #[test]
    fn never_bigger_than_the_input() {
        let input = pdf_with_photo(8, 8);
        let (out, o) = compress(&input, Preset::Strong, None).unwrap();
        assert!(out.len() as u64 <= o.before);
        if o.kept_original {
            assert_eq!(out, input);
        }
    }

    /// Smooth noisy photo pixels, `ch` channels (1, 3 or 4).
    fn photo(w: u32, h: u32, ch: usize) -> Vec<u8> {
        let mut px = Vec::with_capacity((w * h) as usize * ch);
        let mut seed: u32 = 99;
        for y in 0..h {
            for x in 0..w {
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let n = (seed >> 25) as u8 / 8;
                for c in 0..ch {
                    px.push(((x / 4 + y / 3 + c as u32 * 40) % 200) as u8 + n);
                }
            }
        }
        px
    }

    /// A PDF with one page per image; `prep` may add objects (e.g. an ICC profile)
    /// and return more images that refer to them.
    fn pdf_with(images: Vec<Stream>, prep: impl FnOnce(&mut Document) -> Vec<Stream>) -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let mut images = images;
        images.extend(prep(&mut doc));
        let mut kids = Vec::new();
        for img in images {
            let img_id = doc.add_object(img);
            let content = doc.add_object(Stream::new(
                dictionary! {},
                b"q 500 0 0 400 50 200 cm /Im0 Do Q".to_vec(),
            ));
            let page = doc.add_object(dictionary! {
                "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content,
                "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
            });
            kids.push(Object::Reference(page));
        }
        let n = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => n }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn image_stream(dict: lopdf::Dictionary, px: Vec<u8>) -> Stream {
        let mut s = Stream::new(dict, px);
        s.compress().unwrap();
        s
    }

    fn images_of(pdf: &[u8]) -> Vec<Stream> {
        let doc = Document::load_mem(pdf).unwrap();
        doc.objects
            .values()
            .filter_map(|o| match o {
                Object::Stream(s) if is_image(s) => Some(s.clone()),
                _ => None,
            })
            .collect()
    }

    /// PNG-predict rows (filter Up on every row), the way Office writes images.
    fn png_up(px: &[u8], row: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for (r, line) in px.chunks(row).enumerate() {
            out.push(2u8);
            for (i, &b) in line.iter().enumerate() {
                let up = if r > 0 { px[(r - 1) * row + i] } else { 0 };
                out.push(b.wrapping_sub(up));
            }
        }
        out
    }

    #[test]
    fn png_predictor_rows_are_undone_exactly() {
        let (w, h) = (7usize, 5usize);
        let px = photo(w as u32, h as u32, 3);
        // every filter type, one per row
        let mut data = Vec::new();
        for r in 0..h {
            let ft = (r % 5) as u8;
            data.push(ft);
            for i in 0..w * 3 {
                let a = if i >= 3 { px[r * w * 3 + i - 3] as i32 } else { 0 };
                let b = if r > 0 { px[(r - 1) * w * 3 + i] as i32 } else { 0 };
                let c = if r > 0 && i >= 3 {
                    px[(r - 1) * w * 3 + i - 3] as i32
                } else {
                    0
                };
                let pred = match ft {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => (a + b) / 2,
                    _ => {
                        let p = a + b - c;
                        let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                        if pa <= pb && pa <= pc {
                            a
                        } else if pb <= pc {
                            b
                        } else {
                            c
                        }
                    }
                };
                data.push((px[r * w * 3 + i] as i32 - pred) as u8);
            }
        }
        assert_eq!(unpredict_png(&data, w * 3, 3, h).unwrap(), px);
        assert!(unpredict_png(&data[..10], w * 3, 3, h).is_err());
    }

    #[test]
    fn office_style_predicted_image_is_compressed() {
        let (w, h) = (2000u32, 1500u32);
        let px = photo(w, h, 3);
        let img = image_stream(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
                "DecodeParms" => dictionary! { "Predictor" => 15, "Colors" => 3, "BitsPerComponent" => 8, "Columns" => w as i64 },
            },
            png_up(&px, w as usize * 3),
        );
        let input = pdf_with(vec![img], |_| vec![]);
        let (out, o) = compress(&input, Preset::Balanced, None).unwrap();
        assert_eq!(o.images_recompressed, 1, "{o:?}");
        let imgs = images_of(&out);
        assert_eq!(name(&imgs[0], b"Filter"), Some(&b"DCTDecode"[..]));
        assert!(!imgs[0].dict.has(b"DecodeParms"));
        // decodes, and still looks like the photo (not predictor noise)
        let dec = image::load_from_memory(&imgs[0].content).unwrap().to_rgb8();
        let src = image::RgbImage::from_raw(w, h, px).unwrap();
        let small = image::imageops::resize(&src, dec.width(), dec.height(), FilterType::Triangle);
        let diff: u64 = dec
            .pixels()
            .zip(small.pixels())
            .map(|(a, b)| (a[0] as i32 - b[0] as i32).unsigned_abs() as u64)
            .sum();
        let mean = diff / (dec.width() * dec.height()) as u64;
        assert!(mean <= 12, "mean error {mean}");
    }

    #[test]
    fn icc_profile_is_kept_and_16_bit_is_handled() {
        let (w, h) = (2000u32, 1400u32);
        let px16: Vec<u8> = photo(w, h, 3).iter().flat_map(|&b| [b, 0x80]).collect();
        let input = pdf_with(vec![], |doc| {
            let icc = doc.add_object(Stream::new(dictionary! { "N" => 3 }, vec![0u8; 128]));
            vec![image_stream(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                    "ColorSpace" => vec![Object::Name(b"ICCBased".to_vec()), Object::Reference(icc)],
                    "BitsPerComponent" => 16,
                },
                px16,
            )]
        });
        let (out, o) = compress(&input, Preset::Balanced, None).unwrap();
        assert_eq!(o.images_recompressed, 1, "{o:?}");
        let img = &images_of(&out)[0];
        assert_eq!(int(img, b"BitsPerComponent"), Some(8));
        let cs = img.dict.get(b"ColorSpace").unwrap().as_array().unwrap();
        assert_eq!(cs[0].as_name().unwrap(), b"ICCBased", "profile kept");
    }

    #[test]
    fn photo_palettes_are_compressed_but_logo_palettes_are_not() {
        let (w, h) = (1600u32, 1200u32);
        let lut: Vec<u8> = (0..256u32)
            .flat_map(|i| [i as u8, (255 - i) as u8, (i / 2) as u8])
            .collect();
        let idx: Vec<u8> = photo(w, h, 1);
        let palette = |n: i64, lut: Vec<u8>, px: Vec<u8>| {
            image_stream(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                    "ColorSpace" => vec![Object::Name(b"Indexed".to_vec()), Object::Name(b"DeviceRGB".to_vec()), n.into(),
                                         Object::String(lut, lopdf::StringFormat::Hexadecimal)],
                    "BitsPerComponent" => 8,
                },
                px,
            )
        };
        let photo_pal = palette(255, lut, idx.clone());
        let logo = palette(
            3,
            vec![0, 0, 0, 255, 255, 255, 200, 30, 30, 30, 30, 200],
            idx.iter().map(|b| b % 4).collect(),
        );
        let input = pdf_with(vec![photo_pal, logo], |_| vec![]);
        let (out, o) = compress(&input, Preset::Balanced, None).unwrap();
        assert_eq!(o.images_recompressed, 1, "{o:?}");
        let imgs = images_of(&out);
        let jpegs = imgs
            .iter()
            .filter(|s| name(s, b"Filter") == Some(&b"DCTDecode"[..]))
            .count();
        assert_eq!(jpegs, 1);
        assert!(
            imgs.iter().any(|s| matches!(s.dict.get(b"ColorSpace"),
                Ok(Object::Array(a)) if a[0].as_name().ok() == Some(&b"Indexed"[..]))),
            "the logo palette is untouched"
        );
    }

    #[test]
    fn oversized_cmyk_is_shrunk_but_stays_cmyk() {
        let (w, h) = (3000u32, 2000u32);
        let img = image_stream(
            dictionary! {
                "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
                "ColorSpace" => "DeviceCMYK", "BitsPerComponent" => 8,
            },
            photo(w, h, 4),
        );
        let input = pdf_with(vec![img], |_| vec![]);
        let (out, o) = compress(&input, Preset::Balanced, None).unwrap();
        assert_eq!(o.images_recompressed, 1, "{o:?}");
        let img = &images_of(&out)[0];
        assert_eq!(name(img, b"ColorSpace"), Some(&b"DeviceCMYK"[..]));
        assert_eq!(
            name(img, b"Filter"),
            Some(&b"FlateDecode"[..]),
            "lossless, not JPEG"
        );
        assert_eq!(
            (int(img, b"Width"), int(img, b"Height")),
            (Some(1800), Some(1200))
        );
        assert_eq!(img.decompressed_content().unwrap().len(), 1800 * 1200 * 4);
    }

    #[test]
    fn the_same_logo_on_every_page_is_stored_once() {
        let logo = |_: u8| {
            image_stream(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image", "Width" => 300, "Height" => 100,
                    "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
                },
                photo(300, 100, 1),
            )
        };
        let input = pdf_with((0..5).map(logo).collect(), |_| vec![]);
        assert_eq!(images_of(&input).len(), 5);
        let (out, _) = compress(&input, Preset::Light, None).unwrap();
        assert_eq!(images_of(&out).len(), 1, "one copy left");
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 5, "every page still shows it");
    }

    #[test]
    fn not_a_pdf_is_a_plain_error() {
        assert!(compress(b"hello", Preset::Balanced, None)
            .unwrap_err()
            .contains("can't read"));
    }
}
