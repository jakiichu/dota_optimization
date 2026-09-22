import { ok, unknown, type Finding } from '../diagnostics/finding.ts';
import type { AuditRule } from './audit-rule.ts';

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
const compare = 'Повторите запись того же участка игры и сравните плавность до и после изменения.';

export const memoryUsageRule: AuditRule = {
  id: 'resources.memory', title: 'Запас оперативной памяти',
  evaluate(snapshot): Finding {
    const memory = snapshot.resources?.memory;
    if (!memory || memory.totalBytes === null || memory.availableBytes === null || memory.totalBytes <= 0 || memory.availableBytes > memory.totalBytes) {
      return unknown(this.id, this.title, 'Нет достоверных данных о доступной памяти.');
    }
    const observed = `Доступно ${gib(memory.availableBytes)} из ${gib(memory.totalBytes)} на момент проверки.`;
    // Порог — повод проверить запас, а не доказательство подкачки или статтеров.
    const low = memory.availableBytes < 2 * 1024 ** 3 && memory.availableBytes / memory.totalBytes < 0.15;
    if (!low) return ok(this.id, this.title, observed, observed);
    return { ruleId: this.id, title: this.title, severity: 'warning', summary: observed,
      observed, expected: 'Запас памяти во время игры; ориентир проверки — не менее 2 ГБ или 15%.',
      impact: 'Малый запас может привести к дополнительным обращениям к диску. Этот снимок не доказывает нехватку памяти во время игры.',
      remediation: ['В Диспетчере задач отсортируйте процессы по памяти и закройте ненужные приложения, предварительно сохранив работу.', 'Не отключайте файл подкачки ради этой проверки.', compare] };
  },
};

export const diskSpaceRule: AuditRule = {
  id: 'resources.disks', title: 'Место на системном и игровом дисках',
  evaluate(snapshot): Finding {
    const disks = snapshot.resources?.disks;
    if (!disks?.length) return unknown(this.id, this.title, 'Не удалось прочитать локальные диски.');
    const game = snapshot.games.find(game => game.appId === '570');
    const gameDrive = /^[a-z]:/i.exec(game?.installDir ?? '')?.[0]?.toUpperCase();
    const relevant = disks.filter(disk => disk.system || disk.name.toUpperCase() === gameDrive);
    const valid = relevant.filter(disk => disk.totalBytes !== null && disk.totalBytes > 0 && disk.freeBytes !== null && disk.freeBytes >= 0 && disk.freeBytes <= disk.totalBytes);
    if (!valid.length) return unknown(this.id, this.title, 'Нет достоверных данных о свободном месте на нужных дисках.');
    const observed = valid.map(disk => `${disk.name}${disk.system ? ' (Windows)' : ''}${disk.name.toUpperCase() === gameDrive ? ' (Dota)' : ''}: свободно ${gib(disk.freeBytes!)} из ${gib(disk.totalBytes!)}`).join('; ');
    const low = valid.some(disk => disk.freeBytes! < 10 * 1024 ** 3 || disk.freeBytes! / disk.totalBytes! < 0.1);
    const incomplete = valid.length !== relevant.length || !relevant.some(disk => disk.system) || !gameDrive || !valid.some(disk => disk.name.toUpperCase() === gameDrive);
    return { ruleId: this.id, title: this.title, severity: low ? 'warning' : incomplete ? 'unknown' : 'ok',
      summary: low ? 'На одном из проверенных дисков мало свободного места.' : incomplete ? 'На проверенных дисках место есть; часть данных недоступна.' : 'На системном и игровом дисках есть запас места.',
      observed: observed + (incomplete ? '. Не все нужные диски удалось определить или прочитать.' : ''),
      expected: 'Ориентир для проверки: минимум 10 ГБ и 10% свободного места.',
      impact: 'Свободное место нужно для обновлений, временных файлов и записей. Само по себе его освобождение не гарантирует прироста FPS.',
      remediation: low ? ['Откройте Параметры Windows → Система → Память и просмотрите, чем занят диск.', 'Удаляйте только ненужные файлы. Для переноса Dota используйте управление хранилищем Steam.', 'После очистки нажмите «Проверить заново».'] : [] };
  },
};

export const backgroundUsageRule: AuditRule = {
  id: 'resources.background', title: 'Нагрузка других программ',
  evaluate(snapshot): Finding {
    const resources = snapshot.resources;
    if (!resources?.processes?.length || resources.sampleSeconds === null || resources.sampleSeconds < 1) return unknown(this.id, this.title, 'Не удалось измерить нагрузку доступных процессов.');
    // Складываем процессы одного приложения: браузер может состоять из десятков процессов.
    const grouped = new Map<string, { name: string; cpu: number; memory: number }>();
    for (const process of resources.processes) {
      const key = process.name.toLowerCase().replace(/\.exe$/, '');
      if (key === 'dota2') continue;
      const entry = grouped.get(key) ?? { name: process.name, cpu: 0, memory: 0 };
      entry.cpu += process.cpuPercent; entry.memory += process.memoryBytes; grouped.set(key, entry);
    }
    const entries = [...grouped.values()];
    const top = [...entries].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
    const memoryTop = [...entries].sort((a, b) => b.memory - a.memory).slice(0, 3);
    const total = entries.reduce((sum, entry) => sum + entry.cpu, 0);
    const high = total >= 15;
    return { ruleId: this.id, title: this.title, severity: high ? 'warning' : 'info',
      summary: `Другие доступные процессы: ${total.toFixed(1)}% CPU в среднем за ${Math.round(resources.sampleSeconds)} с.`,
      observed: `CPU: ${top.map(p => `${p.name} — ${p.cpu.toFixed(1)}%`).join('; ') || 'нет'}. Память (рабочий набор): ${memoryTop.map(p => `${p.name} — ${gib(p.memory)}`).join('; ') || 'нет'}.`,
      expected: 'Сравнивайте при обычной игровой нагрузке. 15% — ориентир для внимания, а не граница статтеров.',
      impact: 'Доля CPU рассчитана от всей мощности процессора. Dota исключена; программы проверки и другие приложения включены. Недоступные и недавно запущенные процессы могут отсутствовать. Рабочие наборы могут включать общую память.',
      remediation: high ? ['Проверьте перечисленные программы в Диспетчере задач. Сохраните работу и закройте только ненужные пользовательские приложения.', 'Повторите проверку. Системные процессы завершать не нужно.', compare] : ['Для более точной оценки выполните проверку с запущенной игрой.'] };
  },
};
