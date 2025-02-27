const test = require('ava');
const nock = require('nock');
const fetch = require('node-fetch');
const {buildAxiosFetch} = require('../src/index');
const mapValues = require('lodash/mapValues');
const axios = require('axios');
const sinon = require('sinon');
const FormData = require('form-data');

const TEST_URL_ROOT = 'https://localhost:1234';

function cannonicalizeHeaders (headers) {
  return mapValues(headers, function (value) {
    if (Array.isArray(value) && value.length === 1) {
      return value[0];
    } else {
      // All headers should be strings, but nock seems to
      // sometimes provide integer values for headers like
      // content-length
      return String(value);
    }
  });
}

test.before(function (test) {
  nock.disableNetConnect();
  nock(TEST_URL_ROOT)
    .persist()
    .get('/success/text')
    .reply(200, 'OK!')
    .get('/success/json')
    .reply(200, {value: 'OK!'})
    .post('/headers')
    .reply(200, function () {
      return cannonicalizeHeaders(this.req.headers);
    })
    .post('/body')
    .reply(200, function (uri, body) {
      return {
        headers: cannonicalizeHeaders(this.req.headers),
        body
      };
    })
    .get('/failure')
    .reply(501)
    .get('/failureBody')
    .reply(400, {test: true});
});

async function dualFetch (input, init) {
  const expectedResponse = await fetch(input, init);
  const axiosFetch = buildAxiosFetch(axios);
  const axiosResponse = await axiosFetch(input, init);

  return {expectedResponse, axiosResponse};
}

test('returns the expected response on success', async function (test) {
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/success/text`);

  test.truthy(axiosResponse.ok === expectedResponse.ok);
  test.truthy(axiosResponse.status === expectedResponse.status);
  test.truthy(axiosResponse.statusText === expectedResponse.statusText);
});

test('returns the expected response on a JSON body', async function (test) {
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/success/json`);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();
  test.deepEqual(axiosBody, expectedBody);
  test.deepEqual(axiosResponse.headers, expectedResponse.headers);
});

test('returns the expected response on a text body', async function (test) {
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/success/text`);

  const expectedBody = await expectedResponse.text();
  const axiosBody = await axiosResponse.text();
  test.deepEqual(axiosBody, expectedBody);
  test.deepEqual(axiosResponse.headers, expectedResponse.headers);
});

test('respects the headers init option', async function (test) {
  const init = {
    method: 'POST',
    headers: {
      'testheader': 'test-value'
    }
  };
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/headers`, init);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();
  test.deepEqual(axiosBody.testheader, expectedBody.testheader);
});

test('handles text body init options', async function (test) {
  const init = {
    method: 'POST',
    body: 'some text'
  };
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/body`, init);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();
  test.deepEqual(axiosBody.body, expectedBody.body);
  test.deepEqual(axiosBody.headers['content-length'], expectedBody.headers['content-length']);
  test.deepEqual(axiosBody.headers['content-type'], expectedBody.headers['content-type']);
});

test('handles text body with content-type init options', async function (test) {
  const init = {
    method: 'POST',
    body: '{}',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/body`, init);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();
  test.deepEqual(axiosBody.body, expectedBody.body);
  test.deepEqual(axiosBody.headers['content-length'], expectedBody.headers['content-length']);
  test.deepEqual(axiosBody.headers['content-type'], expectedBody.headers['content-type']);
});

test('handles json body init options', async function (test) {
  const init = {
    method: 'POST',
    body: {
      test: 'value'
    }
  };
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/body`, init);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();

  test.deepEqual(axiosBody.body, expectedBody.body);
  test.deepEqual(axiosBody.headers['content-type'], expectedBody.headers['content-type']);
});

test('returns the expected response on a multipart request', async function (test) {
  const data = new FormData();
  data.append('key', 'value');
  const init = {
    method: 'POST',
    body: data
  };

  const input = `${TEST_URL_ROOT}/body`;
  const expectedResponse = await fetch(input, init);

  // FormData is a stream in Node, so you can't reuse it. Make a copy instead.
  const dataCopy = new FormData();
  dataCopy._boundary = data._boundary;
  dataCopy.append('key', 'value');
  init.body = dataCopy;

  const axiosFetch = buildAxiosFetch(axios);
  const axiosResponse = await axiosFetch(input, init);

  const expectedBody = await expectedResponse.json();
  const axiosBody = await axiosResponse.json();

  test.deepEqual(axiosBody.body, expectedBody.body);
});

test('returns the expected response on HTTP status code failures', async function (test) {
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/failure`);

  test.truthy(axiosResponse.ok === expectedResponse.ok);
  test.truthy(axiosResponse.status === expectedResponse.status);
  test.truthy(axiosResponse.statusText === expectedResponse.statusText);
});

test('returns the expected response body on a failure', async function (test) {
  const {expectedResponse, axiosResponse} = await dualFetch(`${TEST_URL_ROOT}/failureBody`);

  const expectedBody = await expectedResponse.text();
  const axiosBody = await axiosResponse.text();
  test.deepEqual(axiosBody, expectedBody);
  test.deepEqual(axiosResponse.headers, expectedResponse.headers);
});

test('allows transforming request options', async function (test) {
  const originalUrl = `${TEST_URL_ROOT}/success/text`;
  const transformedUrl = `${TEST_URL_ROOT}/success/json`;

  let newConfig;
  const transformer = sinon.stub().callsFake(function (config) {
    newConfig = Object.create(config);
    newConfig.url = transformedUrl;
    return newConfig;
  });

  const client = axios.create();
  const requestSpy = sinon.spy(client, 'request');

  const axiosFetch = buildAxiosFetch(client, transformer);

  const init = {extra: 'options'};
  await axiosFetch(originalUrl, init);

  // Make sure the transformer was called with the expected arguments
  test.is(transformer.callCount, 1, 'transformer call count');
  sinon.assert.calledOn(transformer, undefined);
  sinon.assert.calledWithExactly(transformer, sinon.match.object, originalUrl, init);

  // Make sure that the Axio client received the transformed config object
  test.is(requestSpy.callCount, 1, 'request call count');
  sinon.assert.calledOn(requestSpy, client);
  sinon.assert.calledWithExactly(requestSpy, newConfig);
});
