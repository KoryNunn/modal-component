var fastn = require('fastn')({
    _generic: require('fastn/genericComponent'),
    list: require('fastn/listComponent'),
    templater: require('fastn/templaterComponent'),
    text: require('fastn/textComponent'),
    modal: require('./modalComponent')
});

module.exports = function(settings){
    return fastn('modal', settings).attach().render();
};