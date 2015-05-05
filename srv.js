var later       = require('later');
var express     = require('express');
var Redis = require('ioredis');
var Promise     = require('bluebird');
var querystring = require('querystring');
var co          = require('co');
var moment      = require('moment');
var debug       = require('debug')('witty');
var request     = Promise.promisify(require('request'));

var app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

var server = app.listen(3000, () => {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Witty listening at http://%s:%s', host, port);
});

var redis = new Redis(process.env.REDIS_CONNECTION);

var retrieveSched = later.parse.recur().every(1).minute();

var retrieveRecentThreads = function(argBlob) {

  var token = process.env.QUIP_TOKEN;
  let qs = querystring.stringify(argBlob);

  return request({
    uri: `https://platform.quip.com/1/threads/recent?${ qs }`,
    headers: {
      Authorization: `Bearer ${ token }`
    },
    json: true
  })
};

var retrieveSample = function*(max_updated_usec) {

  max_updated_usec = Date.now() * 1000 || max_updated_usec;

  let [response, data] = yield retrieveRecentThreads({
    max_updated_usec: max_updated_usec,
    count: 5
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    debug(`error occurred retrieving sample from ${ max_updated_usec }`);
    debug(data);
  }

  let sampleThreads = Object.keys(data);
  let nearestSecond = Math.floor(max_updated_usec / 1000 / 1000);
  let nearestMinuteBucket = Math.floor(nearestSecond / 60) % 60;
  let bucketKey = `sample:${ nearestMinuteBucket }`;

  debug(`retrieved sample at ${ moment.unix(nearestSecond).format() }, bucketed at ${ nearestMinuteBucket } (${ sampleThreads.join(', ') })`);

  // filter out threads threads in the sample that are not documents
  sampleThreads = sampleThreads.filter((thread) => {
    return data[thread].thread.thread_class === 'document';
  });

  // save thread keys as a sorted set - basde on position (most recently changed)
  let scoredThreads = sampleThreads.map((thread, index) => {
    return [index, thread];
  }).reduce((a, b) => {
    return a.concat(b);
  });

  yield redis.pipeline().del(bucketKey).zadd(bucketKey, scoredThreads).exec();

  // write out individual threads by bucket
  for (let thread of sampleThreads) {
    let threadData = data[thread].thread;

    let sampleThreadKey = `sample:${ nearestMinuteBucket }:thread:${ threadData.id }`;
    yield redis.pipeline().del(sampleThreadKey).hset(sampleThreadKey, ['updated_usec', threadData.updated_usec ]).exec();

    let threadKey = `thread:${ threadData.id }`;
    yield redis.pipeline().del(threadKey).hmset(threadKey, threadData).exec();
  }
};

var analyzeSamples = function*() {

  let threads = {};
  for (let minute = 0; minute < 60; minute++) {

    // zrange will pull in the weighted order
    let sample = yield redis.zrange(`sample:${ minute }`, 0, -1);

    for (let thread of sample) {
      let threadData = yield redis.hgetall(`sample:${ minute }:thread:${ thread }`);

      if (!threads[thread]) threads[thread] = { updates: new Set() };
      threads[thread].updates.add(threadData.updated_usec);
    }
  }

  let threadHistogram = Object.keys(threads).reduce((map, threadKey) => {
    map[threadKey] = threads[threadKey].updates.size;
    return map;
  }, {});

  debug(threadHistogram);
};

var refreshData = function() {

  debug('refreshing data');

  co(function*() {
    yield retrieveSample();
    yield analyzeSamples();
  }).then((map) => {

  }).catch((err) => {
    console.log(err.stack);
  });

};

later.setInterval(refreshData, retrieveSched);
refreshData();
