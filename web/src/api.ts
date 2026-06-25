// Thin client over the Go backend. The UI talks to nothing else.

export interface ObjectInfo {
  path: string;
  size: number;
  lastModified: string;
  isDir: boolean;
}

export interface SearchMatch {
  path: string;
  snippet: string;
  line: number;
}

export interface UploadResult {
  key: string;
  url: string;
  name: string;
  size: number;
}

async function asJSON<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tree(): Promise<ObjectInfo[]> {
    return fetch("/api/tree").then((r) => asJSON<ObjectInfo[]>(r));
  },

  getNote(path: string): Promise<{ path: string; content: string }> {
    return fetch(`/api/note?path=${encodeURIComponent(path)}`).then((r) =>
      asJSON(r),
    );
  },

  saveNote(path: string, content: string): Promise<{ path: string }> {
    return fetch(`/api/note?path=${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown" },
      body: content,
    }).then((r) => asJSON(r));
  },

  deleteNote(path: string): Promise<unknown> {
    return fetch(`/api/note?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }).then((r) => asJSON(r));
  },

  createDir(path: string): Promise<unknown> {
    return fetch(`/api/dir?path=${encodeURIComponent(path)}`, {
      method: "POST",
    }).then((r) => asJSON(r));
  },

  deleteDir(path: string): Promise<unknown> {
    return fetch(`/api/dir?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }).then((r) => asJSON(r));
  },

  search(q: string): Promise<SearchMatch[]> {
    return fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) =>
      asJSON<SearchMatch[]>(r),
    );
  },

  // note: the markdown file the upload belongs to. Images are namespaced under
  // the note's prefix so they're unique to it and removed when it's deleted.
  async upload(file: File, note: string): Promise<UploadResult> {
    const form = new FormData();
    form.append("file", file);
    if (note) form.append("note", note);
    const res = await fetch("/api/blob", { method: "POST", body: form });
    return asJSON<UploadResult>(res);
  },

  blobURL(key: string): string {
    return `/api/blob?key=${encodeURIComponent(key)}`;
  },
};
