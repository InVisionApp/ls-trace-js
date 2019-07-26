'use strict'

const path = require('path')
const execSync = require('../../../../../scripts/helpers/exec')

function executeMocha (args, options) {
  const tracerSetupPath = path.join(__dirname, '..', 'tracer-setup.js')

  // Inject our tracer before we run the external tests
  try {
    return execSync(`npm run env -- mocha '${tracerSetupPath}' ${args} --inspect-brk`, options)
  } catch (err) {} // eslint-disable-line no-empty
}

module.exports = executeMocha
