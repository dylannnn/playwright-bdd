#!/usr/bin/env node

import { Command } from 'commander';
import { testsCommand } from './testsCommand';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json');

const program = new Command();

program
  .name('bddgen')
  .description(`Playwright-bdd CLI v${pkg.version}`)
  .addCommand(testsCommand, { isDefault: true })
  .parse();