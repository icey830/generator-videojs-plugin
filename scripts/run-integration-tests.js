/* global Promise */
/* eslint-disable no-console */

const helpers = require('yeoman-test');
const libs = require('../test/libs.js');
const spawnSync = require('child_process').spawnSync;
const path = require('path');
const assert = require('assert');
const fs = require('fs');

let tempDir;

helpers.run(libs.GENERATOR_PATH)
  .inTmpDir(function(dir) {
    tempDir = dir;
    console.log(`Generating Project in ${tempDir}`);
  })
  .withOptions(Object.assign(libs.options(), {skipInstall: true}))
  .withPrompts({
    name: 'integration-test',
    author: 'John Doe',
    description: 'wat is the plugin',
    docs: true,
    lang: true,
    css: true,
    prepush: true,
    precommit: true
  })
  .then(function() {
    const spawnOptions = {cwd: tempDir, env: Object.assign(process.env, {NPM_MERGE_DRIVER_IGNORE_CI: true})};

    const cleanup = function() {
      console.log(`Cleaning up ${tempDir}`);
      const result = spawnSync(
        path.join(tempDir, 'node_modules', '.bin', 'shx'),
        ['rm', '-rf', tempDir],
        spawnOptions
      );

      if (result.status !== 0) {
        console.error('Failed to cleanup');
      }
    };

    const pkg = JSON.parse(fs.readFileSync(path.join(tempDir, 'package.json')));

    pkg.husky.skipCI = false;

    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(pkg));

    process.on('SIGINT', cleanup);
    process.on('SIGQUIT', cleanup);
    process.on('exit', cleanup);

    const commands = [
      ['git', 'init'],
      ['npm', 'i', '--package-lock-only'],
      ['npm', 'ci'],
      ['git', 'add', '--all'],
      ['git', 'commit', '-a', '-m', 'feat: initial release!'],

      ['npm', 'version', 'prerelease'],
      // copy the changelog over to check its size
      ['shx', 'cp', 'CHANGELOG.md', 'CHANGELOG-prerelease.md'],
      ['npm', 'version', 'major'],
      ['npm', 'publish', '--dry-run'],

      // convoluted npm merge driver test
      ['git', 'checkout', '-b', 'merge-driver-test'],
      ['npm', 'i', '-D', 'is-ci'],
      ['git', 'commit', '-a', '-m', 'add is-ci to dev deps'],
      ['git', 'checkout', 'master'],
      ['npm', 'i', 'is-ci'],
      ['git', 'commit', '-a', '-m', 'add is-ci as dep'],
      ['git', 'merge', '--no-edit', 'merge-driver-test']
    ];

    commands.forEach(function(args) {
      const cmd = args.shift();
      const command = `${path.basename(cmd)} ${args.join(' ')}`;

      const options = Object.assign({}, spawnOptions);

      // print out merge driver command
      if (args[0] === 'merge') {
        options.stdio = 'inherit';
      }

      console.log(`Running '${command}'`);
      const retval = spawnSync(cmd, args, options);

      if (retval.status !== 0) {
        const output = retval.output
          .filter((s) => !!s)
          .map((s) => s.toString())
          .join('');

        console.error(output);
        throw new Error(`${command} Failed`);
      }
    });

    const release = fs.statSync(path.join(tempDir, 'CHANGELOG.md'));
    const prerelease = fs.statSync(path.join(tempDir, 'CHANGELOG-prerelease.md'));

    assert.ok(prerelease.size === 0, 'changelog was not written to after prerelease');
    assert.ok(release.size > 0, 'changelog was written to after major');

    console.log('Making sure npm-merge-driver-install works');

    const mergeDriverRetval = spawnSync('git', ['ls-files', '-u'], spawnOptions);
    const mergeDriverOutput = mergeDriverRetval.output
      .filter((s) => !!s)
      .map((s) => s.toString().trim())
      .join('');

    if (mergeDriverOutput) {
      console.error(mergeDriverOutput);
      throw new Error('npm-merge-driver should have merged conflicts!');
    }

    // test to make sure husky and lint-staged work
    console.log('Making sure husky/lint-staged can fail');
    fs.writeFileSync(path.join(tempDir, 'src', 'plugin.js'), '\n\n\n\n\n\nexport default nothing;');

    const huskyRetval = spawnSync('git', ['commit', '-a', '-m', 'test husky'], Object.assign({stdio: 'inherit'}, spawnOptions));

    if (huskyRetval.status === 0) {
      const output = huskyRetval.output
        .filter((s) => !!s)
        .map((s) => s.toString().trim())
        .join('');

      console.error(output);
      throw new Error('Husky should have errored on linting!');
    }

    // test is a success
    return Promise.resolve();
  }).then(() => {
    process.exit();
  }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
