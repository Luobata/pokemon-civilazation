import { cloneContent, exportContent, importEditorContent } from '../editor/content.ts';
import { EditorSandbox } from '../editor/sandbox.ts';

const editor = document.querySelector<HTMLTextAreaElement>('#content-editor')!;
const notice = document.querySelector<HTMLElement>('#editor-notice')!;
const importFile = document.querySelector<HTMLInputElement>('#import-content')!;
const validation = document.querySelector<HTMLElement>('#validation-result')!;
const simulation = document.querySelector<HTMLElement>('#simulation-result')!;
const actionEditor = document.querySelector<HTMLTextAreaElement>('#simulation-action')!;
let sandbox = new EditorSandbox(cloneContent());
let currentContent = cloneContent();

function setNotice(message: string, kind: 'ok' | 'error' = 'ok'): void {
  notice.textContent = message;
  notice.dataset.state = kind;
}
function syncEditor(content = currentContent): void {
  editor.value = exportContent(content);
}
function refresh(): void {
  const view = sandbox.getView();
  validation.textContent = `种子 ${view.seed} · 第 ${view.round} 轮 · 序列 ${sandbox.seq} · 城市 ${view.economy.cities.length} · 可见单位 ${view.units.length}`;
  simulation.textContent = `当前行动：文明 ${(view.activePlayerId + 1).toString()}；你的序列 ${view.commandSeq}；金币 ${view.economy.player.gold}`;
  actionEditor.value = JSON.stringify({ type: 'EndTurn' }, null, 2);
}
document.querySelector<HTMLButtonElement>('#load-baseline')!.addEventListener('click', () => {
  try {
    currentContent = cloneContent();
    sandbox = new EditorSandbox(currentContent);
    syncEditor(); refresh();
    setNotice('已载入生产内容基线。');
  } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
});
document.querySelector<HTMLButtonElement>('#validate-content')!.addEventListener('click', () => {
  try {
    currentContent = importEditorContent(editor.value);
    sandbox = new EditorSandbox(currentContent);
    setNotice('校验通过；模拟沙箱已切换到这份内容。');
    refresh();
  } catch (error) {
    setNotice(error instanceof Error ? error.message : String(error), 'error');
  }
});
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    currentContent = importEditorContent(text);
    sandbox = new EditorSandbox(currentContent);
    editor.value = exportContent(currentContent);
    setNotice(`已导入并校验 ${file.name}。`);
    refresh();
  } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
  importFile.value = '';
});
document.querySelector<HTMLButtonElement>('#export-content')!.addEventListener('click', () => {
  try {
    const text = exportContent(importEditorContent(editor.value));
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'pokemon-content.json'; link.click();
    URL.revokeObjectURL(url);
    setNotice('已导出校验通过的内容 JSON。');
  } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
});
document.querySelector<HTMLButtonElement>('#reset-simulation')!.addEventListener('click', () => {
  try { sandbox.reset(); setNotice('已重置为同内容新模拟。'); refresh(); }
  catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
});
document.querySelector<HTMLButtonElement>('#run-turn')!.addEventListener('click', () => {
  try {
    const result = sandbox.issue({ type: 'EndTurn' });
    setNotice(result.ok ? '回合命令已被真实引擎接受。' : `引擎拒绝：${result.reason}`, result.ok ? 'ok' : 'error');
    refresh();
  } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
});
document.querySelector<HTMLButtonElement>('#run-action')!.addEventListener('click', () => {
  try {
    const action = JSON.parse(actionEditor.value) as unknown;
    const result = sandbox.issue(action as never);
    setNotice(result.ok ? `命令已执行，序列 ${result.seq}。` : `引擎拒绝：${result.reason}`, result.ok ? 'ok' : 'error');
    refresh();
  } catch (error) { setNotice(error instanceof Error ? error.message : String(error), 'error'); }
});
editor.addEventListener('input', () => setNotice('内容已修改；执行前会重新校验。', 'ok'));
syncEditor();
refresh();

// Clear the fallback only after synchronous page initialization succeeds.
document.querySelector<HTMLElement>('#startup-notice')!.hidden = true;
