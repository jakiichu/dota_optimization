/**
 * Dependency Rule во фронтенде — те же слои, что и на сервере.
 *
 *   main ──▶ ui ──▶ application ──▶ domain
 *     └────▶ infrastructure ──┘
 *
 * domain — модель и её ярлыки, ничего не знает даже о React.
 * application — сценарии и порты: запросы, кеш, подписки.
 * infrastructure — HTTP и SSE, реализация портов.
 * ui — экраны и компоненты; про fetch не знают вовсе.
 * main.tsx — единственное место, где слои встречаются.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'Модель не должна знать ни о React, ни о том, откуда пришли данные.',
      from: { path: '^src/domain' },
      to: { path: '^src/(application|infrastructure|ui)' },
    },
    {
      name: 'domain-no-packages',
      severity: 'error',
      comment: 'domain — это типы и соответствия; библиотеки ему не нужны.',
      from: { path: '^src/domain' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'] },
    },
    {
      name: 'application-inward-only',
      severity: 'error',
      comment: 'Сценарии зависят от порта, а не от его реализации.',
      from: { path: '^src/application' },
      to: { path: '^src/(infrastructure|ui)' },
    },
    {
      name: 'ui-not-infrastructure',
      severity: 'error',
      comment:
        'Экран, который сам зовёт fetch, нельзя ни подменить в тестах, ни перевести на другой транспорт.',
      from: { path: '^src/ui' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'infrastructure-not-ui',
      severity: 'error',
      comment: 'Клиент данных не должен знать про компоненты.',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/ui' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
