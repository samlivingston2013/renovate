const URL = require('url');
const glGot = require('gl-got');
const delay = require('delay');

const parseLinkHeader = require('parse-link-header');
const hostRules = require('../../util/host-rules');

let cache = {};
let endpoint = 'https://gitlab.com/api/v4/';

async function get(path, options, retries = 5) {
  const host = URL.parse(path).host || URL.parse(endpoint).host;
  const opts = {
    // TODO: Move to configurable host rules, or use utils/got
    timeout: 60 * 1000,
    ...hostRules.find({ hostType: 'gitlab', host }),
    ...options,
  };
  const url = URL.resolve(endpoint, path);
  delete opts.endpoint;
  const method = opts.method || 'get';
  const useCache = opts.useCache || true;
  if (method === 'get' && useCache && cache[path]) {
    logger.trace({ path }, 'Returning cached result');
    return cache[path];
  }
  logger.debug({ path }, method.toUpperCase());
  try {
    const res = await glGot(url, opts);
    if (opts.paginate) {
      // Check if result is paginated
      try {
        const linkHeader = parseLinkHeader(res.headers.link);
        if (linkHeader && linkHeader.next) {
          res.body = res.body.concat(
            (await get(linkHeader.next.url, opts, retries)).body
          );
        }
      } catch (err) /* istanbul ignore next */ {
        logger.warn({ err }, 'Pagination error');
      }
    }
    if (method === 'get' && path.startsWith('projects/')) {
      cache[path] = res;
    }
    return res;
  } catch (err) /* istanbul ignore next */ {
    if (retries < 1) {
      throw err;
    }
    if (err.statusCode === 429) {
      logger.info(`Sleeping 1 minute before retrying 429`);
      await delay(60000);
      return get(path, opts, retries - 1);
    }
    throw err;
  }
}

const helpers = ['get', 'post', 'put', 'patch', 'head', 'delete'];

for (const x of helpers) {
  get[x] = (url, opts) =>
    get(url, Object.assign({}, opts, { method: x.toUpperCase() }));
}

get.reset = function reset() {
  cache = null;
  cache = {};
};

get.setEndpoint = e => {
  endpoint = e;
};

module.exports = get;
