// Rotte dell'editor di pipeline: skill, agent, step e collegamenti.
const path = require('path');
const pipelines = require('../services/pipelines');
const { needRoot } = require('../state');
const { NOT_HANDLED } = require('./common');

module.exports = {
  async get(ctx) {
    const { req, res, json } = ctx;
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/fix-active?')) { const q = new URL(req.url, 'http://x').searchParams; return json(200, pipelines.fixActive(q.get('kind'), q.get('name'))); }
    if (req.method === 'GET' && req.url === '/api/pipelines') return json(200, { project: path.basename(needRoot()), ...pipelines.list(needRoot()) });
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/steps?')) return json(200, pipelines.getSteps(needRoot(), new URL(req.url, 'http://x').searchParams.get('skill')));
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/link-preview?')) {
      const q = new URL(req.url, 'http://x').searchParams;
      return json(200, pipelines.linkPreview(needRoot(), q.get('skill'), q.get('agent')));
    }
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/fix-status?')) return json(200, pipelines.fixStatus(new URL(req.url, 'http://x').searchParams.get('id')));
    if (req.method === 'GET' && req.url.startsWith('/api/pipelines/item?')) {
      const q = new URL(req.url, 'http://x').searchParams;
      return json(200, pipelines.read(needRoot(), q.get('kind'), q.get('name')));
    }
    return NOT_HANDLED;
  },
  async post(ctx) {
    const { req, res, json, body } = ctx;
    if (req.url === '/api/pipelines/save') return json(200, pipelines.save(needRoot(), body));
    if (req.url === '/api/pipelines/agent') return json(200, pipelines.createAgent(needRoot(), body));
    if (req.url === '/api/pipelines/steps') return json(200, pipelines.saveSteps(needRoot(), body.steps));
    if (req.url === '/api/pipelines/draft') return json(200, await pipelines.draftAgent(needRoot(), body.description));
    if (req.url === '/api/pipelines/fix') return json(200, pipelines.fixStart(needRoot(), body.kind, body.name));
    if (req.url === '/api/pipelines/fix-cancel') return json(200, pipelines.fixCancel(body.id));
    if (req.url === '/api/pipelines/fix-apply') return json(200, pipelines.fixApply(needRoot(), body));
    if (req.url === '/api/pipelines/skill') return json(200, pipelines.createSkill(needRoot(), body));
    if (req.url === '/api/pipelines/draft-skill') return json(200, await pipelines.draftSkill(needRoot(), body.description));
    if (req.url === '/api/pipelines/skill-steps') return json(200, pipelines.saveSkillSteps(needRoot(), body.skill, body.steps));
    if (req.url === '/api/pipelines/link') return json(200, pipelines.linkApply(needRoot(), body));
    return NOT_HANDLED;
  },
};
