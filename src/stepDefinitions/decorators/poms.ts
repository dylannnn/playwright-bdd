/**
 * POM classes marked with @Fixture
 */

/* eslint-disable @typescript-eslint/ban-types */

import { TestType } from '@playwright/test';
import { BuiltInFixtures } from '../../playwright/types';
import { BddFixtures } from '../../run/bddFixtures';
import { linkStepsWithPomNode } from './steps';

type PomClass = Function;

/**
 * Graph of POM class inheritance.
 * Allows to guess correct fixture by step text.
 */
const pomGraph = new Map<PomClass, PomNode>();

// Representation of POM class with inherited children classes.
export type PomNode = {
  fixtureName: string;
  children: Set<PomNode>;
};

type CustomFixturesNames<T> = T extends TestType<infer U, infer W>
  ? Exclude<keyof U | keyof W, keyof (BuiltInFixtures & BddFixtures) | symbol | number>
  : Exclude<keyof T, symbol | number>;

/**
 * @Fixture decorator.
 */
export function Fixture<T>(fixtureName: CustomFixturesNames<T>) {
  // context parameter is required for decorator by TS even though it's not used
  return (Ctor: Function, _context: ClassDecoratorContext) => {
    createPomNode(Ctor, fixtureName);
  };
}

function createPomNode(Ctor: PomClass, fixtureName: string) {
  const pomNode: PomNode = { fixtureName, children: new Set() };
  pomGraph.set(Ctor, pomNode);
  linkStepsWithPomNode(Ctor, pomNode);
  linkParentWithPomNode(Ctor, pomNode);
  return pomNode;
}

function linkParentWithPomNode(Ctor: PomClass, pomNode: PomNode) {
  const parentCtor = Object.getPrototypeOf(Ctor);
  if (!parentCtor) return;
  // if parentCtor is not in pomGraph, add it as well
  // Case: parent class is not marked with @Fixture, but has decorator steps (base class)
  const parentPomNode = pomGraph.get(parentCtor) || createPomNode(parentCtor, '');
  parentPomNode.children.add(pomNode);
}

export function getPomNodeByFixtureName(fixtureName: string) {
  for (const pomNode of pomGraph.values()) {
    if (pomNode.fixtureName === fixtureName) return pomNode;
  }
}