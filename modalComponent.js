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

        var nextState;
        var handler = function(event){
            var shown = !!component.show();

            if(event.eventPhase === 1){
                nextState = shown;
                return;
            }

            if(nextState != null && nextState !== shown){
                nextState = null;
                return;
            }

            if(shown && !doc(event.target).closest(component.contentElement)){
                component.show(false);
            }
        };

        document.addEventListener('click', handler, true);
        document.addEventListener('click', handler);

        component.on('destroy', function(){
            document.removeEventListener('click', handler, true);
            document.removeEventListener('click', handler);
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

            if(!component.modalElement.parentNode){
                crel(document.body, component.modalElement);
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
    component.show.updater(updateShow);

    return component;
};

module.exports.expectedComponents = ['text', '_generic', 'list', 'templater'];