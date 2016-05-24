var crel = require('crel'),
    doc = require('doc-js'),
    defaultCss = require('defaultcss');

defaultCss('modal-component', '.modal-component{position:fixed;top:0;bottom:0;left:0;right:0;}.modal-component .content{background:white}');

module.exports = function(fastn, component, type, settings, children){
    var lastShowTime;

    component.extend('_generic', settings, children);

    component._type = 'modal';
    component._attachChildren = false;
    component.render = function(){
        component.element = document.createTextNode('');

        component.modalElement = crel('div', {'class':'modal-component'},
            component.containerElement = component.contentElement = crel('div', {'class':'content'})
        );

        component.emit('render');

        var handler = function(event){
            if(
                component.show() &&
                component._isClosable() &&
                !doc(event.target).closest(component.contentElement)
            ){
                component.show(false);
            }
        };

        document.addEventListener('click', handler, true);

        component.on('destroy', function(){
            document.removeEventListener('click', handler, true);
            updateShow(false);
        });

        return component;
    };
    component._insert = function(element, index){
        if(!component.contentElement){
            return;
        }

        if(component.contentElement.childNodes[index] === element){
            return;
        }

        component.contentElement.insertBefore(element, component.contentElement.childNodes[index]);
    };

    component._insertModal = function(){
        crel(document.body, component.modalElement);
    };

    component._isClosable = function(){
        return component.closable();
    };

    var timeout;
    function waitForAnimation(callback){
        if(timeout){
            clearTimeout(timeout);
        }

        // Allow hide timeout for animations
        timeout = setTimeout(callback, settings.animationTime || 0);
    }

    var state = 'hidden';
    function setModalState(newState){
        doc(component.modalElement).removeClass(state).addClass(newState);
        state = newState;
        component.emit('state', state);
    }

    var contentChild;

    function clearContentChild(){
        if(contentChild){
            component.remove(contentChild);
            contentChild.destroy();
            contentChild = null;
        }
    }

    function updateShow(show){
        if(!component.element){
            return;
        }

        if(show){
            lastShowTime = Date.now();

            clearContentChild();

            if(component._settings.content){
                contentChild = fastn.toComponent(component._settings.content(component.scope()));
                component.insert(contentChild);
            }

            if(!component.modalElement.parentNode) {
                component._insertModal();
            }

            setModalState('showing');

            waitForAnimation(function(){
                setModalState('shown');
            });
        }else{
            setModalState('hiding');

            waitForAnimation(function(){
                setModalState('hidden');

                if(component.modalElement.parentNode){
                    component.modalElement.parentNode.removeChild(component.modalElement);
                }

                clearContentChild();
            });
        }
    }

    component.setProperty('show');
    component.setProperty('closable');
    component.closable(true);
    component.show.updater(updateShow);

    return component;
};

module.exports.expectedComponents = ['_generic'];
