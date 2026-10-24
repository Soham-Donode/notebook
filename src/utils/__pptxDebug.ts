import { init as initPptxPreview } from 'pptx-preview';

export async function debugPptx(buffer: ArrayBuffer) {
  const host = document.createElement('div');
  host.style.cssText =
    'position: fixed; left: 0; top: 0; width: 1280px; height: 720px; z-index: 999999; background: #fff;';
  document.body.appendChild(host);

  const previewer = initPptxPreview(host, { width: 1280, height: 720, mode: 'list' });
  await previewer.preview(buffer);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const wrapper = host.querySelector<HTMLElement>('.pptx-preview-wrapper');
  const slides = host.querySelectorAll<HTMLElement>('.pptx-preview-slide-wrapper');
  const classes = new Map<string, number>();
  host.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (cls) classes.set(cls, (classes.get(cls) ?? 0) + 1);
  });

  const result = {
    slideCount: previewer.slideCount,
    hostChildren: host.children.length,
    wrapperExists: Boolean(wrapper),
    wrapperChildren: wrapper?.children.length ?? -1,
    slideNodes: slides.length,
    hostHTML: host.innerHTML.slice(0, 1500),
    classes: Array.from(classes.entries()).slice(0, 30),
    hostRect: host.getBoundingClientRect().toJSON(),
  };

  try {
    previewer.destroy();
  } catch {
    // ignore
  }
  host.remove();
  return result;
}
