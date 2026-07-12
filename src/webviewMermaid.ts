import mermaid from 'mermaid';

const webviewGlobal = globalThis as typeof globalThis & {
  __mermaid: typeof mermaid;
};

mermaid.initialize({
  startOnLoad: true,
  theme: 'default',
  securityLevel: 'strict',
});

webviewGlobal.__mermaid = mermaid;
