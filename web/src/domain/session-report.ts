import type {BottleneckKind, Capture} from './models.ts';

export interface ReportOptions {
    readonly chart: boolean;
    readonly inputLatency: boolean;
}

/** Отчёт собирается по белому списку: произвольные тексты записи не экспортируются. */
export function createSessionReport(capture: Capture, options: ReportOptions): string {
    const diagnosis: Record<BottleneckKind, string> = {
        cpu: 'Разбивка времени кадра указывает на ограничение со стороны процессора.',
        gpu: 'Разбивка времени кадра указывает на ограничение со стороны видеокарты.',
        mixed: 'Соотношение работы процессора и видеокарты менялось по ходу записи.',
        limited: 'Метрики указывают на ограничение частоты кадров или ожидание.',
        unknown: 'Данных для определения узкого места недостаточно.',
    };
    const rows: readonly [string, number | null, string][] = [
        ['Длительность', capture.durationSeconds, 'с'], ['Кадров', capture.frameCount, ''],
        ['Средний FPS', capture.averageFps, ''], ['Медиана кадра', capture.frameTime.p50, 'мс'],
        ['p95 кадра', capture.frameTime.p95, 'мс'], ['p99 кадра', capture.frameTime.p99, 'мс'],
        ['p99.9 кадра', capture.frameTime.p999, 'мс'], ['Статтеров', capture.stutterCount, ''],
        ['Статтеров в минуту', capture.stuttersPerMinute, ''],
    ];
    const latency = options.inputLatency ? `<section><h2>Задержка ввода</h2><p>p99: ${number(capture.inputLatency?.p99 ?? null)} мс.
    Кадров с измерением ввода: ${number(capture.inputLatencyFrames, 0)}.</p>
    <p class="muted">Прочерк означает, что надёжной оценки нет. Запись повтора не заменяет измерение задержки при активной игре.</p></section>` : '';
    const stutters = [...capture.worstStutters].sort((a, b) => b.frameTimeMs - a.frameTimeMs).slice(0, 12);
    return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Кадроскоп — отчёт о записи</title><style>
*{box-sizing:border-box}body{font:16px/1.6 system-ui,sans-serif;background:#f4f6f8;color:#172332;margin:0;padding:32px 18px}
main{max-width:960px;margin:auto}h1{font-size:30px;line-height:1.2;margin:10px 0}h2{font-size:20px;margin:0 0 14px}
section{background:white;border:1px solid #dae1e8;border-radius:12px;padding:22px;margin:18px 0}
.muted,footer{color:#506172;font-size:14px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e7ebef}
svg{width:100%;height:auto}li{margin:6px 0}@media print{body{background:white;padding:0}section{break-inside:avoid}h1{font-size:24px}}
</style></head><body><main><header><p class="muted">КАДРОСКОП · ЗАПИСЬ КАДРОВ</p><h1>Отчёт о плавности</h1>
<p>Показатели одной записи. Название компьютера, подпись записи, пути, конфиг и список программ не включены.</p></header>
<section><h2>Основные показатели</h2><table><thead><tr><th>Показатель</th><th>Значение</th></tr></thead><tbody>
${rows.map(([label, value, unit]) => `<tr><td>${label}</td><td>${number(value)} ${unit}</td></tr>`).join('')}
</tbody></table></section>
${options.chart ? chart(capture) : ''}
<section><h2>Что видно в записи</h2><p>${Object.hasOwn(diagnosis, capture.bottleneck.kind) ? diagnosis[capture.bottleneck.kind] : diagnosis.unknown}</p>
<p>Замеров датчиков: ${number(capture.sensorSampleCount, 0)}.</p>
<p class="muted">Это интерпретация телеметрии, а не доказательство конкретной причины статтеров.</p></section>
${latency}
<section><h2>Самые длинные статтеры</h2>${stutters.length === 0 ? '<p>Детектор не выделил статтеров.</p>' :
        `<table><thead><tr><th>Время от начала, с</th><th>Длительность кадра, мс</th><th>Относительно фона</th></tr></thead><tbody>${stutters.map((s) =>
            `<tr><td>${number(s.atSeconds)}</td><td>${number(s.frameTimeMs)}</td><td>×${number(s.ratio)}</td></tr>`).join('')}</tbody></table>`}</section>
<section><h2>Ограничения и следующий шаг</h2><ul>
<li>Статистика рассчитана по всей записи; увеличение графика в приложении её не меняет.</li>
<li>На коротких записях редкие события и p99.9 могут сильно колебаться.</li>
<li>Нулевое число статтеров означает отсутствие событий по выбранному детектору, а не гарантию идеальной плавности.</li>
<li>Одна запись не показывает эффект настройки. Для проверки запишите ту же сцену до и после одного изменения, желательно по три прогона.</li>
</ul></section><footer>Отчёт сформирован локально. Файл открывается без интернета, скриптов и внешних ресурсов. Это краткий отчёт, а не архив исходной телеметрии.</footer>
</main></body></html>`;
}

function number(value: number | null | undefined, digits = 1): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function chart(capture: Capture): string {
    const points = capture.series.time.flatMap((time, index) => {
        const frame = capture.series.frameTimeMs[index];
        return Number.isFinite(time) && typeof frame === 'number' && Number.isFinite(frame) && time >= 0 && frame >= 0
            ? [{time, frame}] : [];
    });
    if (points.length < 2) return '<section><h2>Время кадра</h2><p>Недостаточно точек для графика.</p></section>';
    // Сохраняем минимум и максимум каждой группы вместо усреднения: пики не исчезают.
    const sampled: typeof points = [];
    const stride = Math.max(1, Math.ceil(points.length / 800));
    for (let start = 0; start < points.length; start += stride) {
        let min = start;
        let max = start;
        for (let i = start + 1; i < Math.min(start + stride, points.length); i++) {
            if (points[i]!.frame < points[min]!.frame) min = i;
            if (points[i]!.frame > points[max]!.frame) max = i;
        }
        for (const index of [...new Set([min, max])].sort((a, b) => a - b)) sampled.push(points[index]!);
    }
    if (sampled[0] !== points[0]) sampled.unshift(points[0]!);
    if (sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1)!);
    const lastTime = points.reduce((max, p) => Math.max(max, p.time), 0);
    const maxFrame = points.reduce((max, p) => Math.max(max, p.frame), 1);
    const coordinates = sampled.map((p) => `${number(55 + p.time / Math.max(lastTime, 0.001) * 810, 2)},${number(240 - p.frame / maxFrame * 210, 2)}`).join(' ');
    const reduced = capture.series.decimated || sampled.length < points.length;
    return `<section><h2>Время кадра</h2><svg viewBox="0 0 900 290" role="img" aria-label="Время кадра в миллисекундах по времени записи">
<path d="M55 25V240H865" fill="none" stroke="#8192a3"/><line x1="55" y1="30" x2="865" y2="30" stroke="#dce3ea"/>
<text x="0" y="35" font-size="12">${number(maxFrame)} мс</text><text x="25" y="244" font-size="12">0</text>
<polyline points="${coordinates}" fill="none" stroke="#126cba" stroke-width="1.4"/>
<text x="55" y="270" font-size="12">0 с</text><text x="865" y="270" text-anchor="end" font-size="12">${number(lastTime)} с</text></svg>
<p class="muted">${reduced ? 'Для компактности показана огибающая: минимумы и максимумы групп точек, без усреднения пиков.' : 'Показаны все доступные точки записи.'} Чем выше пик, тем дольше длился кадр.</p></section>`;
}
