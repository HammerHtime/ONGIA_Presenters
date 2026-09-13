// In-memory stand-in for @netlify/blobs so the functions can run outside Netlify.
const mem = new Map();
export function getStore() {
  return {
    async get(key, { type } = {}) {
      const v = mem.get(key); if (v === undefined) return null;
      if (type === "json") return JSON.parse(v.data);
      if (type === "arrayBuffer") return v.data;
      return v.data;
    },
    async getWithMetadata(key, opts) { const v = mem.get(key); return v ? { data: v.data, metadata: v.metadata } : null; },
    async setJSON(key, value) { mem.set(key, { data: JSON.stringify(value), metadata: {} }); },
    async set(key, data, { metadata } = {}) { mem.set(key, { data: data instanceof ArrayBuffer ? data : Buffer.from(data).buffer.slice(Buffer.from(data).byteOffset, Buffer.from(data).byteOffset + Buffer.from(data).byteLength), metadata }); },
    async delete(key) { mem.delete(key); },
    async list({ prefix }) { return { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
