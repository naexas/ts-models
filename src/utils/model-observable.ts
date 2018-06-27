import {Model} from "../model/base-model";
import {BehaviorList} from "../model/behavior-list";
import {Obj} from "./obj";
import * as _ from "lodash";
import {Observable} from "rxjs/Rx";

/**
 * Used for configuring the Observable<ObservedModel>s generated by the ModelObservable class.
 * The ConfigNode represents a tree, which contains the name of the properties the observable will watch.
 */
export interface ConfigNode {
    name: string;
    children: ConfigNode[];
}

/**
 * Used for the generation of ConfigNodes from strings. The parentNode is not used in the creation of the observables
 * and can be ignored.
 * @property parentNode references the ConfigNode which contains this CCN in its list of children
 */
interface ConnectedConfigNode extends ConfigNode {
    parentNode?: ConfigNode;
}

/**
 * Contains the changed Model, the defined action and the path to the source of the change.
 * In case of elements in lists the path variable does not contain the object's place in the list
 * @property path source of the change
 * @property action defines the nature of the change. Primitive and reference changes are referred to as 'change',
 * BehaviourList actions can be 'add', 'remove', or 'clear'
 * @property model the changed object
 * @property oldValue if a value was changed, then the the original, else its null
 */
export class ObservedModel {
    path: string;
    action: string;
    model: any;
    oldValue?: any;
}

/**
 * Used for generating observables for Model objects. These observables are configurable to watch only certain properties
 * of the Model object. This descriptor is a ConfigNode, which can be generated from a string or created by the user.
 * The observable's next function is called when:
 * - watched object's primitive property is changed
 * - watched object's complex property reference is changed
 * - watched BehaviourList gets an element added or removed
 * - watched BehaviourList gets cleared
 *
 * BehaviourList element properties can be added to the configuration (see example)
 * Adding a complex object to the ConfigNode, which is not part of the applied Model object or is undefined will result
 * in an error. This is because complex objects are watched through the Model's subject property.
 */
export class ModelObservable {

    /**Generates a ConfigNode object from the given string and settings, which can be used in generating observables for
     * the desired object.
     * @example
     * row separator: \n, tabulator: spacespace
     * let node = stringToNode("test","itemList
     * imageList
     *   file
     *   properties
     * complexObject
     *   type
     *   subObject
     *     type
     *     properties
     *   image
     * object","\n","  ");
     * @param {string} name the name of the root config node, usually the name of the object the configuration is made for
     * @param {string} str configuration data, see example
     * @param {string} nodeSeparator separates the configuration node names, see example
     * @param {string} tabulator used for determining parent-child relationships in complex objects, see example
     * @returns {ConfigNode} generated from the given string
     */
    static stringToNode(name: string, str: string, nodeSeparator: string, tabulator: string): ConfigNode {
        let cn: ConnectedConfigNode = {name: name, children: []};
        let rows = str.split(nodeSeparator);
        let currentCn: ConnectedConfigNode = cn;
        let oldTabCount = 0;
        let rgxp = new RegExp(tabulator, "g");
        for (let obj of rows) {
            let currentTabCount = 0;
            currentTabCount = (obj.match(rgxp) || []).length;
            //same level
            if (oldTabCount === currentTabCount) {
            }
            //child
            if (oldTabCount < currentTabCount) {
                currentCn = currentCn.children[currentCn.children.length - 1];
            }
            //upper level (by difference)
            if (oldTabCount > currentTabCount) {
                let i = 0;
                while (i < (oldTabCount - currentTabCount)) {
                    if (!currentCn.parentNode) {
                        throw new Error('parentNode must have a value');
                    }
                    currentCn = currentCn.parentNode;
                    i++;
                }
            }

            let newCn: ConnectedConfigNode = {name: obj, children: [], parentNode: currentCn};
            currentCn.children.push(newCn);
            oldTabCount = currentTabCount;
        }

        return cn;
    }

    /**
     * Creates an Observable<ObservedModel> on the given Model object. The detected fields are set by the ConfigNode.
     * @param {Model} obj observed object
     * @param {ConfigNode} configNode observation config
     * @returns {Observable<ObservedModel>} generated observable
     */
    static getObservable(obj: Model, configNode: ConfigNode): Observable<ObservedModel>;
    static getObservable(obj: Model, configStr: string): Observable<ObservedModel>;
    static getObservable(obj: Model, config: any): Observable<ObservedModel> {
        if (Obj.isString(config))
            config = ModelObservable.stringToNode(obj._modelName, config, '\n', '  ');
        return this.generate(obj, config.children).map(this.pathMap(config.name));
    }

    /**
     * Creates an Observable<ObservedModel> on the given Model object. The detected fields are set by the ConfigNode array.
     * @param {Model} obj observed object
     * @param {ConfigNode[]} configArray determines the watched properties
     * @param fullDetection whether the current obj detects changes on all of its properties or just the ones that are
     * described in the configArray
     * @returns {Observable<ObservedModel>} generated observable
     */
    static generate(obj: Model, configArray: ConfigNode[], fullDetection: boolean = true): Observable<ObservedModel> {
        let observable: Observable<ObservedModel> | null = null;
        if (fullDetection) {
            observable = obj._$;
        }
        else if(!configArray || !configArray.length){
            throw new Error('configArray cannot be null or empty when fullDetection is false');
        }
        configArray.forEach(config => {
            if (!obj[config.name]) {
                throw new Error(`Error while generating model observable. The ${config.name} property does not exist or undefined`);
            }
            if (_.isArray(obj[config.name])) {
                <BehaviorList<Model>>obj[config.name].setSubscriptionConfig(config.children);
                observable = this.combineObservables(observable, obj[config.name]._subject.asObservable(), config.name);
            } else {
                if (config.children.length) {
                    observable = this.combineObservables(observable, this.generate(obj[config.name], config.children), config.name);
                } else {
                    observable = this.combineObservables(observable, obj[config.name]._subject.asObservable(), config.name);
                }
            }
        });

        return observable ? observable : obj._$;
    }

    /**
     * Merges two observables and appends the path variable of the ObservedModel appropriately.
     * @param {Observable<ObservedModel>} observable original observable
     * @param {Observable<ObservedModel>} otherObservable newly added observable
     * @param {string} prop name of the currently viewed property
     * @returns {Observable<ObservedModel>}
     */
    private static combineObservables(observable: Observable<ObservedModel> | null,
                                      otherObservable: Observable<ObservedModel>,
                                      prop: string): Observable<ObservedModel> {
        if (!observable) {
            return otherObservable.map(this.pathMap(prop));
        }
        return observable.merge(otherObservable.map(this.pathMap(prop)));
    }

    /**
     * Mapping for the correct path visualization
     * @param prop name of the currently viewed property
     * @returns {(value) => ObservedModel} modified observedModel with correct path
     */
    private static pathMap(prop: string): (value: ObservedModel) => ObservedModel {
        return value => {
            if (value.path) {
                value.path = prop + '.' + value.path;
            } else {
                value.path = prop;
            }
            return value;
        }
    }
}