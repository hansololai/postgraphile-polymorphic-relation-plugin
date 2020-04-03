import { Build } from 'postgraphile';
import {
  PgAttribute,
  PgProc,
  PgClass,
  PgConstraint,
  PgExtension,
  PgType,
  PgNamespace,
  PgIndex,
  SQL,
  QueryBuilder,
} from 'graphile-build-pg';

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
interface SimplePgTableIntrospect {
  name: string;
  id: string;
  attributesMap: AttributesMap;
}
export interface AttributesMap {
  [x: string]: PgAttribute | PgProc;
}
export type FieldToDBMap = {
  [x: string]: SimplePgTableIntrospect;
};
export interface PgPolymorphicConstraint {
  name: string;
  from: PgClass; // classId
  backwardAssociationName?: string; // field name for backward association. (default table name)
  to: {
    pgClass: PgClass,
    pKey: PgAttribute,
    name: string,
  }[]; // due to limitation at the time, it is the ModelName array.
}
export type PgPolymorphicConstraints = PgPolymorphicConstraint[];
export interface ResolveFieldProps {
  sourceAlias: SQL;
  fieldName: string;
  fieldValue: any;
  queryBuilder: QueryBuilder;
}
export type SqlFragment = any;
export type ResolveFieldFunc = (prop: ResolveFieldProps) => SqlFragment | null;
