/**
 * Generate playwright test files from Gherkin documents.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { TestFile } from './testFile';
import { FeaturesLoader, resolveFeatureFiles } from '../cucumber/loadFeatures';
import { Snippets } from '../snippets';
import { getPlaywrightConfigDir } from '../config/configDir';
import { Logger } from '../utils/logger';
import parseTagsExpression from '@cucumber/tag-expressions';
import { exit, withExitHandler } from '../utils/exit';
import { loadSteps, resolveStepFiles } from '../steps/load';
import { relativeToCwd } from '../utils/paths';
import { BDDConfig } from '../config/types';
import { stepDefinitions } from '../steps/registry';

export class TestFilesGenerator {
  private featuresLoader = new FeaturesLoader();
  private files: TestFile[] = [];
  private tagsExpression?: ReturnType<typeof parseTagsExpression>;
  private logger: Logger;

  constructor(private config: BDDConfig) {
    this.logger = new Logger({ verbose: config.verbose });
    if (config.tags) this.tagsExpression = parseTagsExpression(config.tags);
  }

  async generate() {
    await withExitHandler(async () => {
      await Promise.all([this.loadFeatures(), this.loadSteps()]);
      this.buildFiles();
      this.checkUndefinedSteps();
      await this.clearOutputDir();
      await this.saveFiles();
    });
  }

  async extractSteps() {
    await this.loadSteps();
    return stepDefinitions;
  }

  // todo: combine with extractSteps
  async extractUnusedSteps() {
    await Promise.all([this.loadFeatures(), this.loadSteps()]);
    this.buildFiles();
    return stepDefinitions.filter((stepDefinition) => {
      const isUsed = this.files.some((file) => file.usedStepDefinitions.has(stepDefinition));
      return !isUsed;
    });
  }

  private async loadFeatures() {
    const cwd = getPlaywrightConfigDir();
    const featureFiles = await resolveFeatureFiles(cwd, this.config.features);
    this.logger.log(`Loading features: ${this.config.features}`);
    this.logger.log(`Resolved feature files: ${featureFiles.length}`);
    featureFiles.forEach((featureFile) => this.logger.log(`  ${relativeToCwd(featureFile)}`));
    await this.featuresLoader.load(featureFiles, {
      relativeTo: cwd,
      defaultDialect: this.config.language,
    });
    this.handleFeatureParseErrors();
  }

  private async loadSteps() {
    const { importTestFrom } = this.config;
    const cwd = getPlaywrightConfigDir();
    this.logger.log(`Loading steps: ${this.config.steps}`);
    const stepFiles = await resolveStepFiles(cwd, this.config.steps);
    if (importTestFrom) stepFiles.push(importTestFrom.file);
    this.logger.log(`Resolved step files: ${stepFiles.length}`);
    stepFiles.forEach((stepFiles) => this.logger.log(`  ${relativeToCwd(stepFiles)}`));
    await loadSteps(stepFiles);
    this.logger.log(`Loaded steps: ${stepDefinitions.length}`);
  }

  private buildFiles() {
    this.files = this.featuresLoader
      .getDocumentsWithPickles()
      .map((gherkinDocument) => {
        return new TestFile({
          gherkinDocument,
          // doc.uri is always relative to cwd (coming after cucumber handling)
          // see: https://github.com/cucumber/cucumber-js/blob/main/src/api/gherkin.ts#L51
          outputPath: this.getSpecPathByFeaturePath(gherkinDocument.uri!),
          config: this.config,
          tagsExpression: this.tagsExpression,
        }).build();
      })
      .filter((file) => file.testCount > 0);
  }

  private getSpecPathByFeaturePath(relFeaturePath: string) {
    const configDir = getPlaywrightConfigDir();
    const absFeaturePath = path.resolve(configDir, relFeaturePath);
    const relOutputPath = path.relative(this.config.featuresRoot, absFeaturePath);
    if (relOutputPath.startsWith('..')) {
      exit(
        `All feature files should be located underneath featuresRoot.`,
        `Please change featuresRoot or paths in configuration.\n`,
        `featureFile: ${absFeaturePath}\n`,
        `featuresRoot: ${this.config.featuresRoot}\n`,
      );
    }
    const absOutputPath = path.resolve(this.config.outputDir, relOutputPath);
    return `${absOutputPath}.spec.js`;
  }

  private checkUndefinedSteps() {
    const snippets = new Snippets(this.files);
    if (snippets.hasUndefinedSteps()) {
      snippets.print();
      exit();
    }
  }

  // private checkImportTestFrom() {
  //   if (hasCustomTest && !this.config.importTestFrom) {
  //     exit(
  //       `When using custom "test" function in createBdd() you should`,
  //       `set "importTestFrom" config option that points to file exporting custom test.`,
  //     );
  //   }
  // }

  private async saveFiles() {
    this.logger.log(`Generating Playwright tests: ${this.files.length}`);
    this.files.forEach((file) => {
      file.save();
      this.logger.log(`  ${relativeToCwd(file.outputPath)}`);
    });
  }

  private async clearOutputDir() {
    const pattern = `${fg.convertPathToPattern(this.config.outputDir)}/**/*.spec.js`;
    const testFiles = await fg(pattern);
    this.logger.log(`Clearing output dir: ${relativeToCwd(pattern)}`);
    const tasks = testFiles.map((testFile) => fs.rm(testFile));
    await Promise.all(tasks);
  }

  private handleFeatureParseErrors() {
    const { parseErrors } = this.featuresLoader;
    if (parseErrors.length) {
      const message = parseErrors
        .map((parseError) => {
          return `Parse error in "${parseError.source.uri}" ${parseError.message}`;
        })
        .join('\n');
      exit(message);
    }
  }
}
