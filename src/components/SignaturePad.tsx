// Make a signature: draw it, type it in a handwriting font, or use an image.
// Signatures are kept on this computer only (browser storage of the app),
// so they can be reused; nothing is sent anywhere.

import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { createStore, toastError } from "../lib/store";
import { useSyncExternalStore } from "react";

export interface Signature {
  id: string;
  /** PNG data URL, trimmed to the ink. */
  dataUrl: string;
  /** Pixel size of the PNG, for its aspect ratio. */
  w: number;
  h: number;
}

const KEY = "deskfolio-signatures";
const sigStore = createStore<Signature[]>(readSigs());
function readSigs(): Signature[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((s) => s && typeof s.dataUrl === "string").slice(0, 12) : [];
  } catch {
    // Storage unavailable: start empty.
    return [];
  }
}
function writeSigs(list: Signature[]) {
  sigStore.set(list);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Kept for this session only.
  }
}
export const useSignatures = () => useSyncExternalStore(sigStore.subscribe, sigStore.get);
export const deleteSignature = (id: string) => writeSigs(sigStore.get().filter((s) => s.id !== id));

/** Crop a canvas to its non-transparent pixels (plus a small margin). */
function trimmed(canvas: HTMLCanvasElement): Signature | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const m = 6;
  [x0, y0, x1, y1] = [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(width - 1, x1 + m), Math.min(height - 1, y1 + m)];
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")?.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { id: `${Date.now()}`, dataUrl: out.toDataURL("image/png"), w: out.width, h: out.height };
}

const HANDS = ['"Segoe Script", "Brush Script MT", cursive', '"Lucida Handwriting", "Apple Chancery", cursive', '"Ink Free", "Bradley Hand", cursive'];

export function SignaturePad({ onDone, onCancel }: { onDone: (s: Signature) => void; onCancel: () => void }) {
  const [tab, setTab] = useState<"draw" | "type" | "image">("draw");
  const [typed, setTyped] = useState("");
  const [hand, setHand] = useState(0);
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = pad.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    if (tab === "type" && typed.trim()) {
      ctx.fillStyle = "#15151a";
      let size = 96;
      ctx.font = `${size}px ${HANDS[hand]}`;
      while (ctx.measureText(typed).width > c.width - 40 && size > 24) {
        size -= 4;
        ctx.font = `${size}px ${HANDS[hand]}`;
      }
      ctx.textBaseline = "middle";
      ctx.fillText(typed, 20, c.height / 2);
      setHasInk(true);
    }
  }, [tab, typed, hand]);

  const pos = (e: React.PointerEvent) => {
    const c = pad.current as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };

  const start = (e: React.PointerEvent) => {
    if (tab !== "draw") return;
    const ctx = pad.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.strokeStyle = "#15151a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const moveTo = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = pad.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };

  const pickImage = async () => {
    try {
      const path = await open({ title: "Signature image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }] });
      if (typeof path !== "string") return;
      const bytes = await api.readFile(path);
      const type = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
      const img = new Image();
      img.onload = () => {
        const c = pad.current;
        const ctx = c?.getContext("2d");
        if (!c || !ctx) return;
        ctx.clearRect(0, 0, c.width, c.height);
        const k = Math.min(c.width / img.width, c.height / img.height);
        ctx.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
        URL.revokeObjectURL(url);
        setHasInk(true);
      };
      img.src = url;
    } catch (e) {
      toastError(e);
    }
  };

  const save = () => {
    const c = pad.current;
    if (!c) return;
    const s = trimmed(c);
    if (!s) return;
    writeSigs([s, ...sigStore.get()].slice(0, 12));
    onDone(s);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sig-h">
      <div className="modal sig-modal">
        <h2 id="sig-h">New signature</h2>
        <div className="segmented" role="tablist">
          {(["draw", "type", "image"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "draw" ? "Draw" : t === "type" ? "Type" : "Image"}
            </button>
          ))}
        </div>
        {tab === "type" && (
          <div className="sig-type">
            <input autoFocus value={typed} placeholder="Your name" onChange={(e) => setTyped(e.target.value)} />
            <div className="segmented small-seg">
              {HANDS.map((_, i) => (
                <button key={i} className={hand === i ? "active" : ""} style={{ fontFamily: HANDS[i] }} onClick={() => setHand(i)}>
                  Signature
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === "image" && (
          <button className="sig-pick" onClick={() => void pickImage()}>
            Choose a PNG or JPG of your signature…
          </button>
        )}
        <canvas
          ref={pad}
          className={tab === "draw" ? "sig-pad drawable" : "sig-pad"}
          width={900}
          height={300}
          onPointerDown={start}
          onPointerMove={moveTo}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <p className="muted small">
          {tab === "draw" ? "Sign with your mouse, pen or finger." : "Saved on this computer only, so you can reuse it."}
        </p>
        <div className="modal-actions">
          {tab === "draw" && (
            <button
              className="link"
              onClick={() => {
                const c = pad.current;
                c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
                setHasInk(false);
              }}
            >
              Clear
            </button>
          )}
          <span className="grow" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!hasInk} onClick={save}>
            Use this signature
          </button>
        </div>
      </div>
    </div>
  );
}
