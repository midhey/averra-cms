// Линт SCSS: конфиг frontend-kit (f904954) — стандартный набор правил SCSS и три правила кита.
// Biome SCSS не разбирает, поэтому стили проверяет stylelint (pnpm lint). Отличие от кита одно:
// в CSS-модулях админки классы в camelCase (styles.navLink) и разрешён :global

const kebabOrBem =
  '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:__(?:[a-z0-9]+(?:-[a-z0-9]+)*))?(?:--(?:[a-z0-9]+(?:-[a-z0-9]+)*))?$'

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard-scss'],
  rules: {
    'selector-class-pattern': [kebabOrBem, { message: 'Классы — kebab-case или BEM' }],
    'scss/at-use-no-unnamespaced': true,
    'scss/load-no-partial-leading-underscore': true,
    'scss/no-global-function-names': true,
  },
  overrides: [
    {
      files: ['**/*.module.scss'],
      rules: {
        'selector-class-pattern': [
          '^[a-z][a-zA-Z0-9]*$',
          { message: 'Классы CSS-модулей — camelCase: в коде это styles.имяКласса' },
        ],
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global'] }],
      },
    },
  ],
}
