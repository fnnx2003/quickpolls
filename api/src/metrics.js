import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const pollsCreated = new client.Counter({
    name: "quickpolls_polls_created_total",
    help: "Number of polls created",
    registers: [registry],
  });

  const votesCast = new client.Counter({
    name: "quickpolls_votes_total",
    help: "Number of votes cast",
    registers: [registry],
  });

  function middleware(req, res, next) {
    const end = httpDuration.startTimer();
    res.on("finish", () => {
      const route = req.route ? req.baseUrl + req.route.path : "unmatched";
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  }

  async function handler(req, res) {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  }

  return { registry, middleware, handler, pollsCreated, votesCast };
}
