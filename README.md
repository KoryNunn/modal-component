# modal-component

A simple modal component

Built with `fastn.js`

# Usage

## Settings

```
{
    show: any truthy/falsey value
}
```

## Standalone

```
// Create the modal
var modal = createPicker({
        options: ['foo', 'bar', 'baz']
    });

// Watch for changes to the modal's value
modal.value.on('change', function(value){
    console.log(value);
});

// Put the modal's element somewhere in the DOM.
document.body.appendChild(modal.element);
```

## Fastn component

```
var fastn = require('fastn')({
    ... other components...
    modal: require('modal-component/modalComponent')
});

var modal = fastn('modal', { options... });
```

modal will attempt to use `text`, `_generic`, `list` and `templater` components provided by fastn.

## Inserting

```
someDomNode.appendChild(modal.element);
```

## Properties

### Show

```
// retrieve value
modal.show(); // returns value of show

// set value
modal.show(newValue); -// returns modal.show property

// watch for changes
modal.show.on('change', function(show){
    // Do something
});
```