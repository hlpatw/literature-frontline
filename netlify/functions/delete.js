const handler = require("../../api/delete.js").default;
exports.handler = async (event, context) => {
  const response = await handler({
    method: event.httpMethod,
    json: async () => JSON.parse(event.body)
  }, {
    status: (code) => ({
      json: (data) => ({
        statusCode: code,
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      })
    })
  });
  return response;
};
