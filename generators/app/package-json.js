'use strict';

const _ = require('lodash');
const generatorVersion = require('./generator-version');
const pkg = require('../../plugin/package.json');

pkg.optionalDependencies = pkg.optionalDependencies || {};
pkg.devDependencies = pkg.devDependencies || {};

const getGeneratorVersion = (pkgName) =>
  pkg.optionalDependencies[pkgName] || pkg.devDependencies[pkgName] || pkg.dependencies[pkgName];

const getGeneratorVersions = (pkgList) => pkgList.reduce((acc, pkgName) => {
  const version = getGeneratorVersion(pkgName);

  if (!version) {
    throw new Error(`Error ${pkgName} is not in dependencies for generator-videojs-plugin`);
  }

  acc[pkgName] = version;
  return acc;
}, {});

const DEFAULTS = {
  dependencies: getGeneratorVersions(['global', 'video.js']),
  devDependencies: getGeneratorVersions([
    'conventional-changelog-cli',
    'conventional-changelog-videojs',
    'karma',
    'npm-run-all',
    'rollup',
    'shx',
    'videojs-generate-rollup-config',
    'videojs-generate-karma-config',
    'not-prerelease',
    'sinon',
    'videojs-standard',
    'npm-merge-driver-install',
    'husky',
    'lint-staged',
    'videojs-generator-verify'
  ])
};

/**
 * Takes advantage of the way V8 orders object properties - by their
 * assignment order - to "sort" an object in alphabetic order.
 *
 * @param  {Object} source
 *         A plain object to be sorted.
 *
 * @return {Object}
 *         A new ordered object.
 */
const alphabetizeObject = (source) =>
  _.pick(source, Object.keys(source).sort());

/**
 * Identical to `alphabetizeObject`, but there is special handling to
 * preserve the ordering of "pre" and "post" scripts next to their
 * core scripts. For example:
 *
 *    "preversion": "...",
 *    "version": "...",
 *    "postversion": "..."
 *
 * @param  {Object} source
 *         A plain object to be sorted.
 *
 * @return {Object}
 *         A new ordered object.
 */
const alphabetizeScripts = (source) => {
  const keys = Object.keys(source);
  const prePost = keys.filter(k => _.startsWith(k, 'pre') || _.startsWith(k, 'post'));
  const order = _.difference(keys, prePost).sort();

  // Inject the pre/post scripts into the order where they belong.
  prePost.forEach(pp => {
    const isPre = _.startsWith(pp, 'pre');
    const i = order.indexOf(pp.substr(isPre ? 3 : 4));

    // Insert pre-scripts in place of their related core script and
    // post-scripts after their related core script.
    if (i > -1) {
      order.splice(isPre ? i : i + 1, 0, pp);

    // If this is a pre/post script with no related core script, just
    // stick it on the end. This is an unlikely case, though.
    } else {
      order.push(pp);
    }
  });

  return _.pick(source, order);
};

/**
 * Create a package.json based on options.
 *
 * @param  {Object} current
 *         Representation of current package.json.
 *
 * @param  {Object} context
 *         Generator rendering context.
 *
 * @return {Object}
 *         A new representation package.json.
 */
const packageJSON = (current, context) => {
  current = current || {};

  // Replaces all "%s" tokens with the name of the plugin in a given string.
  const scriptify = (str) => {
    str = Array.isArray(str) ? str.join(' ') : str;
    return str.replace(/%s/g, context.pluginName);
  };

  const result = _.assign({}, current, {
    'name': context.packageName,
    'version': context.version,
    'description': context.description,
    'main': scriptify('dist/%s.cjs.js'),
    'module': scriptify('dist/%s.es.js'),

    'generator-videojs-plugin': {
      version: generatorVersion()
    },
    'browserslist': [
      'defaults',
      'ie 11'
    ],
    'scripts': _.assign({}, current.scripts, {
      'prebuild': 'npm run clean',
      'build': 'npm-run-all -p build:*',
      'build:js': 'rollup -c scripts/rollup.config.js',
      'clean': 'shx rm -rf ./dist ./test/dist',
      'postclean': 'shx mkdir -p ./dist ./test/dist',
      'lint': 'vjsstandard',
      'prepublishOnly': 'npm-run-all build test:verify',
      'start': 'npm-run-all -p server watch',
      'server': 'karma start scripts/karma.conf.js --singleRun=false --auto-watch',
      'pretest': 'npm-run-all lint build',
      'test': 'npm-run-all test:*',
      'test:verify': 'vjsverify --verbose',
      'test:unit': 'karma start scripts/karma.conf.js',
      'posttest': 'shx cat test/dist/coverage/text.txt',
      'preversion': 'npm test',
      'version': 'is-prerelease || npm run update-changelog && git add CHANGELOG.md',
      'update-changelog': 'conventional-changelog -p videojs -i CHANGELOG.md -s',
      'watch': 'npm-run-all -p watch:*',
      'watch:js': 'npm run build:js -- -w'
    }),

    'engines': {
      node: '>=8',
      npm: '>=5'
    },

    // Always include the two minimum keywords with whatever exists in the
    // current keywords array.
    'keywords': _.union(['videojs', 'videojs-plugin'], current.keywords).sort(),

    'author': context.author,
    'license': context.licenseName,

    'vjsstandard': {
      ignore: [
        'dist',
        'docs',
        'test/dist'
      ]
    },

    'files': [
      'CONTRIBUTING.md',
      'dist/',
      'docs/',
      'index.html',
      'scripts/',
      'src/',
      'test/'
    ],
    'husky': {
      hooks: {
        'pre-commit': 'lint-staged',
        'pre-push': 'npm run test'
      }
    },
    'lint-staged': {
      '*.js': [
        'vjsstandard --fix',
        'git add'
      ],
      'README.md': [
        'npm run docs:toc',
        'git add'
      ]
    },

    'dependencies': _.assign({}, current.dependencies, DEFAULTS.dependencies),

    'devDependencies': _.assign(
      {},
      current.devDependencies,
      DEFAULTS.devDependencies
    )
  });

  // In case husky was previously installed, but is now "none", we can
  // remove it from the package.json entirely.
  if (!context.precommit) {
    delete result.scripts.precommit;
    delete result.husky.hooks['pre-commit'];
    delete result['lint-staged'];
  }

  if (!context.prepush) {
    delete result.scripts.prepush;
    delete result.husky.hooks['pre-push'];
  }

  if (!context.prepush && !context.precommit) {
    delete result.devDependencies.husky;
    delete result.devDependencies['lint-staged'];
  }

  // Support the documentation tooling option.
  if (context.docs) {

    _.assign(result.scripts, {
      'docs': 'npm-run-all docs:*',
      'docs:api': 'jsdoc src -g plugins/markdown -r -d docs/api',
      'docs:toc': 'doctoc README.md'
    });

    _.assign(result.devDependencies, getGeneratorVersions(['doctoc', 'jsdoc']));
  }

  if (context.css) {
    _.assign(result.scripts, {
      'build:css': scriptify('postcss -o dist/%s.css --config scripts/postcss.config.js src/plugin.css'),
      'watch:css': 'npm run build:css -- -w'
    });

    _.assign(result.devDependencies, getGeneratorVersions([
      'postcss-cli',
      'videojs-generate-postcss-config'
    ]));

  }

  // Include language support. Note that `mkdirs` does not need to change
  // here because the videojs-languages package will create the destination
  // directory if needed.
  if (context.lang) {
    result.scripts['build:lang'] = 'vjslang --dir dist/lang';
    _.assign(result.devDependencies, getGeneratorVersions(['videojs-languages']));
  }

  result.files.sort();
  result.scripts = alphabetizeScripts(result.scripts);
  result.dependencies = alphabetizeObject(result.dependencies);
  result.devDependencies = alphabetizeObject(result.devDependencies);

  return result;
};

module.exports = packageJSON;
