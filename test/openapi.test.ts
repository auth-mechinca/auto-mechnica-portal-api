import './helpers/env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { buildOpenApiDocument } from '../src/openapi.js';

/** The document is generated from the service schemas, so what needs guarding is
 *  not the shapes — the compiler already checks those — but the hand-written
 *  parts: paths, methods and $refs. Those are the pieces that can quietly stop
 *  describing the app. */

type Doc = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown> };
};

let server: Server;
let doc: Doc;

before(() => {
  server = createApp().listen(0);
  doc = buildOpenApiDocument() as unknown as Doc;
});
after(() => server.close());

describe('the OpenAPI document', () => {
  it('is served as OpenAPI 3.1', async () => {
    const res = await request(server).get('/openapi.json');
    assert.equal(res.status, 200);
    assert.equal(res.body.openapi, '3.1.0');
  });

  it('renders Swagger UI without a token', async () => {
    const res = await request(server).get('/docs/');
    assert.equal(res.status, 200);
    assert.match(res.text, /swagger-ui/);
  });

  it('resolves every $ref it uses', () => {
    const refs = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') refs.add(value);
        else walk(value);
      }
    };
    walk(doc.paths);

    assert.ok(refs.size > 0, 'expected the paths to reference components');
    for (const $ref of refs) {
      const name = $ref.replace('#/components/schemas/', '');
      assert.ok(doc.components.schemas[name], `${$ref} does not exist`);
    }
  });

  it('describes only routes that actually exist', async () => {
    // A documented path that 404s is a promise the API does not keep. No token
    // is sent, so an existing protected route answers 401 or 403 — anything but
    // 404 proves the path is real.
    for (const [path, operations] of Object.entries(doc.paths)) {
      const url = path.replace('{id}', '99999999-9999-4999-8999-999999999999');

      for (const method of Object.keys(operations)) {
        const res = await request(server)[method as 'get' | 'post'](url).send({});
        assert.notEqual(res.status, 404, `${method.toUpperCase()} ${path} is documented but missing`);
      }
    }
  });

  it('documents every implemented module, and no unimplemented one', () => {
    const paths = Object.keys(doc.paths);
    assert.ok(paths.some((p) => p.startsWith('/api/auth/')));
    assert.ok(paths.some((p) => p.startsWith('/api/pos/')));

    // These routers are mounted and enforce roles but have no handlers. Once one
    // gains an endpoint, this test should be updated along with the document.
    for (const unimplemented of ['/api/ims/', '/api/financial/', '/api/backoffice/']) {
      assert.ok(
        !paths.some((p) => p.startsWith(unimplemented)),
        `${unimplemented} has no handlers yet — documenting it would promise a 404`,
      );
    }
  });

  it('keeps login and health outside the bearer requirement', () => {
    const open = (operation: unknown) => (operation as { security?: unknown[] }).security;
    assert.deepEqual(open(doc.paths['/api/auth/login']!.post), []);
    assert.deepEqual(open(doc.paths['/health']!.get), []);
    // Everything else inherits the document-level requirement.
    assert.equal(open(doc.paths['/api/pos/sales']!.post), undefined);
  });
});
