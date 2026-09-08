/**
 * Машинная проверка Dependency Rule: зависимости указывают только внутрь.
 *
 *   main ──▶ adapters ──▶ application ──▶ domain
 *     └────▶ infrastructure ──┘
 *
 * domain не знает ни о чём. application знает только про domain и свои порты.
 * infrastructure и adapters реализуют порты, но никогда не вызывают друг друга.
 * Composition root (main) — единственное место, где слои встречаются.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'domain — чистые бизнес-правила: ни ввода-вывода, ни знания о внешнем мире.',
      from: { path: '^src/domain' },
      to: { path: '^src/(application|adapters|infrastructure|main)' },
    },
    {
      name: 'domain-no-node-builtins',
      severity: 'error',
      comment:
        'Обращение к node: в domain означает, что правило стало непроверяемым в тестах.',
      from: { path: '^src/domain' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'domain-no-npm-packages',
      severity: 'error',
      comment: 'domain не должен зависеть от библиотек — только от языка.',
      from: { path: '^src/domain' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'] },
    },
    {
      name: 'application-inward-only',
      severity: 'error',
      comment:
        'Сценарии зависят от портов, а не от их реализаций (DIP).',
      from: { path: '^src/application' },
      to: { path: '^src/(adapters|infrastructure|main)' },
    },
    {
      name: 'application-no-io',
      severity: 'error',
      comment:
        'Ввод-вывод в сценарии — это адаптер, который забыли вынести за порт.',
      from: { path: '^src/application' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'adapters-not-infrastructure',
      severity: 'error',
      comment:
        'Адаптер представления не должен знать про конкретный сборщик данных.',
      from: { path: '^src/adapters' },
      to: { path: '^src/(infrastructure|main)' },
    },
    {
      name: 'infrastructure-not-adapters',
      severity: 'error',
      comment: 'Сборщики данных не знают про презентеры.',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/(adapters|main)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Модуль, на который никто не ссылается, — вероятно, мёртвый код.',
      from: { orphan: true, pathNot: ['\.d\.ts$', '(^|/)tsconfig\.json$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.js'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
    },
  },
};
