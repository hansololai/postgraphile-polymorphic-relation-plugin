import { Build } from 'postgraphile';
import {
  PgAttribute,
  PgProc,
  PgClass,
  PgConstraint,
  PgExtension,
  PgType,
  PgNamespace,
} from 'graphile-build-pg';
import { PgIndex } from 'graphile-build-pg/node8plus/plugins/PgIntrospectionPlugin';

export interface GraphilePgIntrospection {
  __pgVersion: number;
  attribute: PgAttribute[];
  attributeByClassIdAndNum: { [classId: string]: { [num: string]: PgAttribute } };
  class: PgClass[];
  classById: { [x: string]: PgClass };
  constraint: PgConstraint[];
  extension: PgExtension[];
  extensionById: { [x: string]: PgExtension };
  index: PgIndex[];
  namespace: PgNamespace[];
  namespaceById: { [x: string]: PgNamespace };
  procedure: PgProc[];
  type: PgType[];
  typeById: { [x: string]: PgType };
}
export interface GraphileBuild extends Build {
  pgIntrospectionResultsByKind: GraphilePgIntrospection;
}
