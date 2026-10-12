//! Make PDFs smaller: re-encode photos at a sensible resolution and JPEG
//! quality, drop unused objects, write compact object streams. Nothing else
//! changes (text, vectors, forms stay as they are), and the result is never
//! larger than the input: when it would be, the original is kept.
//!
//! Only image kinds that can be re-encoded without changing how they look
//! are touched: 8-bit RGB or greyscale images stored as JPEG (DCT) or Flate.
//! Masks, CMYK, palette (Indexed), ICC-profile and 1-bit images are left
//! alone. Every image's size is checked before it is decoded, so a hostile
//! PDF can't make this allocate gigabytes.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageBuffer, Luma, Rgb};
use lopdf::{Document, Object, Stream};
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

pub fn compress(input: &[u8], preset: Preset, password: Option<&str>) -> Result<(Vec<u8>, Outcome), String> {
    let mut doc = match password {
        Some(pw) if !pw.is_empty() => Document::load_mem_with_password(input, pw),
        _ => Document::load_mem(input),
    }
    .map_err(|e| format!("can't read this PDF: {e}"))?;
    if doc.is_encrypted() {
        return Err("This PDF is password-protected; open it with its password first.".into());
    }

    let (max_side, quality) = preset.params();
    let mut seen = 0;
    let mut done = 0;
    let ids: Vec<_> = doc.objects.keys().copied().collect();
    for id in ids {
        let Some(Object::Stream(stream)) = doc.objects.get_mut(&id) else {
            continue;
        };
        if !is_image(stream) {
            continue;
        }
        seen += 1;
        match recompress(stream, max_side, quality) {
            Ok(true) => done += 1,
            Ok(false) => {}
            Err(e) => tracing::debug!("image {id:?} left as is: {e}"),
        }
    }

    doc.delete_zero_length_streams();
    doc.prune_objects();
    doc.compress();
    let mut out = Vec::with_capacity(input.len() / 2);
    doc.save_modern(&mut out).map_err(|e| format!("can't write the smaller PDF: {e}"))?;

    let before = input.len() as u64;
    if out.len() as u64 >= before {
        return Ok((
            input.to_vec(),
            Outcome { before, after: before, images_seen: seen, images_recompressed: done, kept_original: true },
        ));
    }
    let after = out.len() as u64;
    Ok((out, Outcome { before, after, images_seen: seen, images_recompressed: done, kept_original: false }))
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

/// Re-encode one image stream in place. Ok(false) = skipped or not smaller.
fn recompress(s: &mut Stream, max_side: u32, quality: u8) -> Result<bool, String> {
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
    let gray = match name(s, b"ColorSpace") {
        Some(b"DeviceRGB") => false,
        Some(b"DeviceGray") => true,
        _ => return Ok(false), // CMYK, Indexed, ICCBased, arrays: leave alone
    };
    let filters: Vec<Vec<u8>> = s.filters().map(|f| f.iter().map(|x| x.to_vec()).collect()).unwrap_or_default();
    let img = match filters.iter().map(Vec::as_slice).collect::<Vec<_>>().as_slice() {
        [b"DCTDecode"] => {
            // Small JPEGs are already as good as they get.
            if s.content.len() < 60_000 {
                return Ok(false);
            }
            image::load_from_memory_with_format(&s.content, image::ImageFormat::Jpeg).map_err(|e| e.to_string())?
        }
        [b"FlateDecode"] | [] => {
            if int(s, b"BitsPerComponent") != Some(8) {
                return Ok(false);
            }
            // Row predictors add a byte per row: rather than undo them by
            // hand, leave such images alone.
            if s.dict.has(b"DecodeParms") {
                return Ok(false);
            }
            let raw = if filters.is_empty() {
                s.content.clone()
            } else {
                s.decompressed_content().map_err(|e| e.to_string())?
            };
            let channels = if gray { 1 } else { 3 };
            if raw.len() < (w as usize) * (h as usize) * channels {
                return Ok(false);
            }
            if gray {
                DynamicImage::ImageLuma8(
                    ImageBuffer::<Luma<u8>, _>::from_raw(w, h, raw[..(w * h) as usize].to_vec()).ok_or("bad grey image")?,
                )
            } else {
                DynamicImage::ImageRgb8(
                    ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, raw[..(w * h * 3) as usize].to_vec()).ok_or("bad RGB image")?,
                )
            }
        }
        _ => return Ok(false), // JPX, CCITT, JBIG2, chains: leave alone
    };

    let img = if w.max(h) > max_side {
        let scale = max_side as f64 / w.max(h) as f64;
        let nw = ((w as f64 * scale).round() as u32).max(1);
        let nh = ((h as f64 * scale).round() as u32).max(1);
        img.resize_exact(nw, nh, FilterType::Triangle)
    } else {
        img
    };

    let mut jpeg = Vec::new();
    let mut enc = JpegEncoder::new_with_quality(&mut jpeg, quality);
    let (nw, nh, is_gray) = if gray {
        let g = img.to_luma8();
        enc.encode_image(&g).map_err(|e| e.to_string())?;
        (g.width(), g.height(), true)
    } else {
        let c = img.to_rgb8();
        enc.encode_image(&c).map_err(|e| e.to_string())?;
        (c.width(), c.height(), false)
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
        Object::Name(if is_gray { b"DeviceGray".to_vec() } else { b"DeviceRGB".to_vec() }),
    );
    s.set_content(jpeg);
    // Already compressed as JPEG; don't wrap it in Flate as well.
    s.allows_compression = false;
    Ok(true)
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
        let content = Stream::new(dictionary! {}, b"q 500 0 0 400 50 200 cm /Im0 Do Q".to_vec());
        let content_id = doc.add_object(content);
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page", "Parent" => pages_id, "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Contents" => content_id,
            "Resources" => dictionary! { "XObject" => dictionary! { "Im0" => img_id } },
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 }),
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

    #[test]
    fn not_a_pdf_is_a_plain_error() {
        assert!(compress(b"hello", Preset::Balanced, None).unwrap_err().contains("can't read"));
    }
}
