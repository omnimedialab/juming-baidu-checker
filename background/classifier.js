/**
 * 把 baidu/chinaz 信号转成 green/yellow/red。
 * 规则可被 settings 覆盖。
 */

export function classify(signals, settings) {
  const greenMin = settings.greenMinIndexed ?? 10;
  const yellowMin = settings.yellowMinIndexed ?? 1;
  const reasons = [];

  if (!signals.baidu || !signals.baidu.ok) {
    return {
      status: 'error',
      reasons: ['baidu-fetch-failed:' + (signals.baidu?.error || 'unknown')]
    };
  }

  const { baiduCount, ranksFirst } = signals.baidu;
  reasons.push(`baidu-indexed=${baiduCount}`);
  reasons.push(`ranks-first=${ranksFirst}`);

  let score = 0;
  if (baiduCount >= greenMin) score += 2;
  else if (baiduCount >= yellowMin) score += 1;
  if (ranksFirst) score += 1;

  if (signals.chinaz && signals.chinaz.ok && typeof signals.chinaz.chinazBR === 'number') {
    reasons.push(`chinaz-br=${signals.chinaz.chinazBR}`);
    if (signals.chinaz.chinazBR >= 1) score += 1;
  }

  let status;
  if (baiduCount === 0) status = 'red';
  else if (score >= 3) status = 'green';
  else if (score >= 1) status = 'yellow';
  else status = 'red';

  return { status, reasons, score };
}
