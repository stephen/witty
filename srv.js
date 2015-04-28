var later   = require('later');
var express = require('express');
var Promise = require('bluebird');
var request = Promise.promisify(require('request'));

var app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

var server = app.listen(3000, () => {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Witty listening at http://%s:%s', host, port);
});

var retrieveSched = later.parse.text('every minute');
later.date.UTC();

var retrieveRecentThreads = function() {

  var token = process.env.QUIP_TOKEN;

  return request({
    uri: 'https://platform.quip.com/1/threads/recent',
    headers: {
      Authorization: `Bearer ${ token }`
    }
  })
};

var refreshData = function() {
  retrieveRecentThreads().spread((response, data) => {
    if (response.statusCode < 200 && response.statusCode >= 300) {
      // ...
    }

    data = JSON.parse(data);

    Object.keys(data).forEach((threadId) => {
      console.log(threadId);
    });

  });
};

later.setInterval(refreshData, retrieveSched);
refreshData();
