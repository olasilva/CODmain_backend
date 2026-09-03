function list(name) { return (req, res) => res.json({ data: [], resource: name }); }
function create(name) { return (req, res) => res.status(201).json({ message: `${name} created`, data: req.body }); }
function update(name) { return (req, res) => res.json({ message: `${name} updated`, id: req.params.id || req.params[`${name}Id`], data: req.body }); }
function remove(name) { return (req, res) => res.json({ message: `${name} deleted` }); }
module.exports = { list, create, update, remove };
