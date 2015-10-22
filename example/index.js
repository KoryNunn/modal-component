var createModal = require('../'),
    crel = require('crel');

window.onload = function(){

    // Create a modal.
    var modal = createModal({

        content: function(scope){
            // What to render when the modal is shown.
            // Return a string, a DOM node, or a fastn component here.

            return crel('div',
                crel('h1', 'Hello World'),
                'My cool modal'
            );
        }

    });

    document.body.appendChild(modal.element);

    var button = crel('button', 'Show modal');
    button.addEventListener('click', function(){
        modal.show(true);
    });

    document.body.appendChild(button);

};