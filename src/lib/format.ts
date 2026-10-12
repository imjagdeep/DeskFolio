// Display and path helpers.

export function humanSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
}

/** "report.pdf" -> "report (suffix).pdf", in the same folder. */
export function siblingPath(path: string, suffix: string, ext?: string): string {
  const dir = parentDir(path);
  const sep = path.includes("\\") ? "\\" : "/";
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const oldExt = dot > 0 ? name.slice(dot + 1) : "";
  const newName = `${stem} (${suffix}).${ext ?? (oldExt || "pdf")}`;
  return dir === path ? newName : `${dir}${sep}${newName}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
