import { readFileSync, writeFileSync } from 'node:fs';

const bundlePath = new URL('../.mastra/output/index.mjs', import.meta.url);
const bundle = readFileSync(bundlePath, 'utf8');
const signature = '_toFetchResponse(status, statusText, sentHeaders, initialDataChunks, finished) {';
const signatureCount = bundle.split(signature).length - 1;
const adapterStart = bundle.indexOf(signature);
const adapterEnd = bundle.indexOf('return new Response(body', adapterStart);

if (signatureCount !== 1 || adapterStart === -1 || adapterEnd === -1) {
  throw new Error(
    `Expected exactly one fetch-to-node response adapter, found ${signatureCount}. ` +
      'Refusing to emit an unverified build; reassess the workaround for mastra-ai/mastra#20332.',
  );
}

const adapter = bundle.slice(adapterStart, adapterEnd);
const emitsClose = adapter.includes('emit("close")') || adapter.includes("emit('close')");
const fixPresent = adapter.includes('cancel()') && emitsClose;

if (fixPresent) {
  console.log('MCP stream cancellation fix already present; temporary patch was not needed.');
} else {
  const blockStart = bundle.indexOf('const _this = this;', adapterStart);
  const blockEndToken = '}) : null;';
  const blockEnd = bundle.indexOf(blockEndToken, blockStart);
  const vulnerableBlock = bundle.slice(blockStart, blockEnd + blockEndToken.length);
  const expectedParts = [
    'controller.close()',
    '_this.on("finish"',
    '_this.on("_dataWritten"',
    'controller.enqueue(data)',
  ];

  if (
    blockStart === -1 ||
    blockEnd === -1 ||
    blockEnd >= adapterEnd ||
    !expectedParts.every(part => vulnerableBlock.includes(part))
  ) {
    throw new Error(
      'The fetch-to-node adapter no longer matches the known vulnerable structure. ' +
        'Refusing to emit an unverified build; reassess the workaround for mastra-ai/mastra#20332.',
    );
  }

  const patchedBlock = `const _this = this;
\t\tlet cancelled = false;
\t\tlet body = this._hasBody ? new ReadableStream({
\t\t\tstart(controller) {
\t\t\t\tfor (const dataChunk of initialDataChunks) controller.enqueue(dataChunk);
\t\t\t\tif (finished) {
\t\t\t\t\ttry {
\t\t\t\t\t\tcontroller.close();
\t\t\t\t\t} catch {}
\t\t\t\t} else {
\t\t\t\t\t_this.on("finish", () => {
\t\t\t\t\t\tfinished = true;
\t\t\t\t\t\tif (cancelled) return;
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tcontroller.close();
\t\t\t\t\t\t} catch {}
\t\t\t\t\t});
\t\t\t\t\t_this.on("_dataWritten", (e) => {
\t\t\t\t\t\tif (finished || cancelled) return;
\t\t\t\t\t\tconst data = _this.dataFromDataWrittenEvent(e);
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tcontroller.enqueue(data);
\t\t\t\t\t\t} catch {}
\t\t\t\t\t});
\t\t\t\t}
\t\t\t},
\t\t\tcancel() {
\t\t\t\tcancelled = true;
\t\t\t\t_this.emit("close");
\t\t\t}
\t\t}) : null;`;

  const patchedBundle =
    bundle.slice(0, blockStart) + patchedBlock + bundle.slice(blockEnd + blockEndToken.length);
  writeFileSync(bundlePath, patchedBundle);
  console.log('Applied temporary MCP stream cancellation patch (mastra-ai/mastra#20332).');
}
