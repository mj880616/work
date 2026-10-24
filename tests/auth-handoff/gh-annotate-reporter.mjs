// GitHub Actions에서만 실패한 시험을 check-run annotation(::error)으로 남긴다.
// Actions 로그 본문을 못 읽어도(403) check-runs/<id>/annotations로 시험 이름·파일·줄·오류를 볼 수 있다.
// 로컬에서는 아무것도 출력하지 않는다. 시험 결과·종료 코드는 바꾸지 않는다.
import { relative } from 'node:path';

const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export default async function* ghAnnotate(source) {
  const on = process.env.GITHUB_ACTIONS === 'true';
  const root = process.env.GITHUB_WORKSPACE || process.cwd();
  for await (const event of source) {
    if (!on || event.type !== 'test:fail') continue;
    const { name, file, line, details } = event.data;
    const error = details?.error;
    // 부모 시험의 "하위 시험 실패" 줄은 건너뛰고 실제 실패만 남긴다.
    if (error?.failureType === 'subtestsFailed') continue;
    const cause = error?.cause ?? error;
    const message = [cause?.code, cause?.message ?? String(cause ?? error)].filter(Boolean).join(' ').slice(0, 1500);
    const props = [file ? `file=${escProp(relative(root, file))}` : '', line ? `line=${line}` : '', `title=${escProp(name).slice(0, 200)}`].filter(Boolean).join(',');
    yield `::error ${props}::${esc(message)}\n`;
  }
}
