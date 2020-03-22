# postgraphile-polymorphic-relation-plugin
[![hansololai](https://circleci.com/gh/hansololai/postgraphile-polymorphic-relation-plugin.svg?style=svg)](https://app.circleci.com/pipelines/github/hansololai/postgraphile-polymorphic-relation-plugin?branch=master)
[![Maintainability](https://api.codeclimate.com/v1/badges/7ad51fc0d6c2b9c5e416/maintainability)](https://codeclimate.com/github/hansololai/postgraphile-polymorphic-relation-plugin/maintainability)
[![Test Coverage](https://api.codeclimate.com/v1/badges/7ad51fc0d6c2b9c5e416/test_coverage)](https://codeclimate.com/github/hansololai/postgraphile-polymorphic-relation-plugin/test_coverage)
[![Known Vulnerabilities](https://snyk.io//test/github/hansololai/postgraphile-polymorphic-relation-plugin/badge.svg?targetFile=package.json)](https://snyk.io//test/github/hansololai/postgraphile-polymorphic-relation-plugin?targetFile=package.json)
<!-- [![npm version](https://img.shields.io/npm/v/postgraphile-plugin-connection-filter-polymorphic)](https://www.npmjs.com/package/postgraphile-plugin-connection-filter-polymorphic) -->

# Postgraphile Polymorphic Relation Plugin
This plugin create the associations linked via a polymorphic association. Polymorphic associations are defined like this [in ruby on rails](https://guides.rubyonrails.org/association_basics.html#polymorphic-associations).


## Feature
The postgraphile by default includes relation plugins that create associations based on foreign key. For example
```sql
create table users{
  id: integer primary_key,
  name: text
};
create table posts{
  id: integer primary_key,
  author_id: integer references users (id)
};
```
The `Post` model will not only have `author_id` field, and will also have an `userByAuthorId` object. 

But it does not work for polymorphic associations. 
```sql
create table taggs(
  id: integer primary_key,
  taggable_type: text,
  taggable_id: integer,
);

create table user(
  id: integer,
  name: text,
);
```
If you add a [smart comment](https://www.graphile.org/postgraphile/smart-comments/#gatsby-focus-wrapper) to define polymorphic associations. like so 
```
comment on column taggs.taggable_type is E'@isPolymorphic\n@polymorphicTo User';
```
This will allow the plugin to know that the `taggs` table is polymorphic associated with `user`. Then the `Tagg` model will have a field called `userAsTaggable`.  and `User` model will have a field called `taggs`. 
```graphql
allTaggs{
  nodes{
    userAsTaggable{
      id
      taggs{
        nodes{
          id
        }
      }
    }
  }
}
```

If there is an Unique Constraint on the two columns `taggable_type` and `taggable_id`, then the field in `User` is `tagg` (singular) instead of `taggs`. (It will be a single model isntead of a connection)

```sql
alter table taggs add constraint unique_taggable UNIQUE (taggable_type, taggable_id);
```

```graphql
allUsers{
  nodes{
    id
    tagg{
      id
    }
  }
}
```
### Also provide a connectionFilter
In the above example, 
And a record in taggs is 
```
id: 50
taggable_type: 'User'
taggable_id: 1
```
This means the tag(id:50) is connected to User record of id:1. 

If you want to filter the connections like the following:
```graphql
allTaggs(filter:{
  userAsTaggable:{id:1} // This does not exist in regular connection filter
}){
  nodes{
    id
  }
}
```
This plugin will create the forward relationship. (this `userAsTaggable`) field, and also the backward relationship. (the `taggs` field on User Connection, and other connections that is associated). Also if the `taggable_type` and `taggable_id` are has an unique constraint. The backward filter is not a single object filter, instead of a multi-field, which consist of three fields `some`,`every`,`none`. 

## Usage
Requires postgraphile@4.2+. 
### Usage of connection filter
To enable this function, it requires postgraphile@4.2+ and the following plugins appended prior to this plugin:
- `postgraphile-plugin-connection-filter@^1.0.0`

Also an build option is needed. like so
```js
createPostGraphileSchema(client, ['p'], {
        appendPlugins: [
          // This is important to be added if the two options are true
          PgConnectionFilterPlugin, 
          postgraphilePolyRelationCorePlugin,
        ],
        graphileBuildOptions: {
          connectionFilterPolymorphicForward: true,
          connectionFilterPolymorphicBackward: true,
        },
      });
```
The two options will create the filter options. 

### Install it
```
npm install postgraphile-polymorphic-relation-plugin
```
Use it by adding it in

```js
import {postgraphilePolyRelationCorePlugin} from 'postgraphile-polymorphic-relation-plugin';
createPostGraphileSchema(pgClient, [schemaName],{
  appendPlugin: [
    postgraphilePolyRelationCorePlugin
  ]
})
```

The npm package exposes every intermediate plugins such as 
`addModelTableMappingPlugin`: add the model to table mapping dictionary.
`definePolymorphicCustom`: add the polymorphic definition in Build object, used by other plugin
`addForwardPolyAssociation`: Use the defined polymorphic objects to construct forward relation,
`addBackwardPolyAssociation`: Use the defined polymorphic objects to construct backward relation, 

## Development

To establish a test environment, create an empty PostgreSQL database and set a `TEST_DATABASE_URL` environment variable with your database connection string.

```bash
createdb graphile_test
export TEST_DATABASE_URL=postgres://localhost:5432/graphile_test
yarn
yarn test
```
