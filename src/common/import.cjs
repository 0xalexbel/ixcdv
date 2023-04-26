/**
 * @param {string} path 
 */
function importJsonModule(path) {
    return require(path);
}

module.exports = {
    importJsonModule
}