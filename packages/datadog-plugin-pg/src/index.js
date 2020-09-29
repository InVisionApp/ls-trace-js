'use strict'

const Tags = require('opentracing').Tags
const analyticsSampler = require('../../dd-trace/src/analytics_sampler')

const OPERATION_NAME = 'pg.query'

function createWrapQuery (tracer, config) {
  return function wrapQuery (query) {
    return function queryWithTrace () {
      const scope = tracer.scope()
      const childOf = scope.active()
      const span = tracer.startSpan(OPERATION_NAME, {
        childOf,
        tags: {
          [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
          'service.name': config.service || `${tracer._service}-postgres`,
          'span.type': 'sql',
          'db.type': 'postgres'
        }
      })

      analyticsSampler.sample(span, config.analytics)

      const retval = scope.bind(query, span).apply(this, arguments)
      const queryQueue = this.queryQueue || this._queryQueue
      const activeQuery = this.activeQuery || this._activeQuery
      const pgQuery = queryQueue[queryQueue.length - 1] || activeQuery

      if (!pgQuery) {
        return retval
      }

      const originalCallback = pgQuery.callback
      const statement = (pgQuery.cursor && pgQuery.cursor.text) || pgQuery.text
      const params = this.connectionParameters

      if (isReadableStream(pgQuery)) {
        pgQuery.on('close', () => finishSpan(span))
        pgQuery.on('error', (err) => finishSpan(span, err))
      }

      span.setTag('resource.name', statement)

      if (params) {
        span.addTags({
          'db.name': params.database,
          'db.user': params.user,
          'out.host': params.host,
          'out.port': params.port
        })
      }

      pgQuery.callback = scope.bind((err, res) => {
        finishSpan(span, err)

        if (originalCallback) {
          originalCallback(err, res)
        }
      }, childOf)

      return retval
    }
  }
}

function finishSpan (span, err) {
  if (err) {
    span.setTag('error', err)
  }

  span.finish()
}

function isReadableStream (query) {
  return query.readable && typeof query.on === 'function'
}

module.exports = [
  {
    name: 'pg',
    versions: ['>=4'],
    patch (pg, tracer, config) {
      this.wrap(pg.Client.prototype, 'query', createWrapQuery(tracer, config))
    },
    unpatch (pg) {
      this.unwrap(pg.Client.prototype, 'query')
    }
  },
  {
    name: 'pg',
    versions: ['>=4'],
    file: 'lib/native/index.js',
    patch (Client, tracer, config) {
      this.wrap(Client.prototype, 'query', createWrapQuery(tracer, config))
    },
    unpatch (Client) {
      this.unwrap(Client.prototype, 'query')
    }
  }
]
