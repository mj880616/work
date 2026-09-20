// Imported by the Edge handler without loading the optional HWP package at boot.
export async function extractHwp(bytes, name) {
  const {default: HwpxReader, hwpToText} = await import('npm:@ssabrojs/hwpxjs');
  let result;
  if (name.toLowerCase().endsWith('.hwp')) {
    result = await hwpToText(bytes);
  } else {
    const reader = new HwpxReader();
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await reader.loadFromArrayBuffer(arrayBuffer);
    result = await reader.extractText();
  }
  return result.length > 50000 ? result.slice(0, 50000) + '\n…[이하 생략]' : result;
}
