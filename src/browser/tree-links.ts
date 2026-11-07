// Connector lines for card trees (League charters, v22 tech tree): one cubic curve from the right edge of each
// requirement's card to the left edge of the card that needs it, drawn into an absolutely positioned SVG.
export type TreeEdge = { from: string; to: string; className?: string };

/** Draws `edges` between `[${attribute}="id"]` cards inside `tree`; needs real layout (returns early while hidden). */
export function drawTreeLinks(tree: HTMLElement, svg: SVGSVGElement, attribute: string, edges: readonly TreeEdge[]): void {
  const box = tree.getBoundingClientRect();
  if (!box.width) return;
  // Scrolled content: measure against the full scroll size so lines past the visible edge are drawn too.
  const width = Math.max(box.width, tree.scrollWidth), height = Math.max(box.height, tree.scrollHeight);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.innerHTML = edges.map(edge => {
    const from = tree.querySelector<HTMLElement>(`[${attribute}="${edge.from}"]`)?.getBoundingClientRect();
    const to = tree.querySelector<HTMLElement>(`[${attribute}="${edge.to}"]`)?.getBoundingClientRect();
    if (!from || !to) return '';
    const [x1, y1, x2, y2] = [from.right - box.left, from.top + from.height / 2 - box.top, to.left - box.left, to.top + to.height / 2 - box.top];
    const path = `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
    return `<path d="${path}" data-from="${edge.from}" data-to="${edge.to}" class="${edge.className ?? ''}"/>`;
  }).join('');
}
