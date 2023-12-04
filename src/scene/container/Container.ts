import EventEmitter from 'eventemitter3';
import { Color, type ColorSource } from '../../color/Color';
import { Matrix } from '../../maths/matrix/Matrix';
import { DEG_TO_RAD, RAD_TO_DEG } from '../../maths/misc/const';
import { ObservablePoint } from '../../maths/point/ObservablePoint';
import { uid } from '../../utils/data/uid';
import { deprecation, v8_0_0 } from '../../utils/logging/deprecation';
import { childrenHelperMixin } from './container-mixins/childrenHelperMixin';
import { effectsMixin } from './container-mixins/effectsMixin';
import { findMixin } from './container-mixins/findMixin';
import { measureMixin } from './container-mixins/measureMixin';
import { onRenderMixin } from './container-mixins/onRenderMixin';
import { sortMixin } from './container-mixins/sortMixin';
import { toLocalGlobalMixin } from './container-mixins/toLocalGlobalMixin';
import { RenderGroup } from './RenderGroup';
import { assignWithIgnore } from './utils/assignWithIgnore';

import type { PointData } from '../../maths/point/PointData';
import type { Rectangle } from '../../maths/shapes/Rectangle';
import type { Renderable } from '../../rendering/renderers/shared/Renderable';
import type { BLEND_MODES } from '../../rendering/renderers/shared/state/const';
import type { View } from '../../rendering/renderers/shared/view/View';
import type { Dict } from '../../utils/types';
import type { DestroyOptions } from './destroyTypes';

/**
 * @namespace scene
 */

// as pivot and skew are the least used properties of a container, we can use this optimisation
// to avoid allocating lots of unnecessary objects for them.
const defaultSkew = new ObservablePoint(null);
const defaultPivot = new ObservablePoint(null);
const defaultScale = new ObservablePoint(null, 1, 1);

export interface ContainerEvents extends PixiMixins.ContainerEvents
{
    added: [container: Container];
    childAdded: [child: Container, container: Container, index: number];
    removed: [container: Container];
    childRemoved: [child: Container, container: Container, index: number];
    destroyed: [];
}

type AnyEvent = {
    // The following is a hack to allow any custom event while maintaining type safety.
    // For some reason, the tsc compiler gets angry about error TS1023
    // "An index signature parameter type must be either 'string' or 'number'."
    // This is really odd since ({}&string) should interpret as string, but then again
    // there is some black magic behind why this works in the first place.
    // Closest thing to an explanation:
    // https://stackoverflow.com/questions/70144348/why-does-a-union-of-type-literals-and-string-cause-ide-code-completion-wh
    //
    // Side note, we disable @typescript-eslint/ban-types since {}&string is the only syntax that works.
    // Nor of the Record/unknown/never alternatives work.
    // eslint-disable-next-line @typescript-eslint/ban-types
    [K: ({} & string) | ({} & symbol)]: any;
};

export const UPDATE_COLOR = 0b0001;
export const UPDATE_BLEND = 0b0010;
export const UPDATE_VISIBLE = 0b0100;
export const UPDATE_TRANSFORM = 0b1000;

/**
 * Constructor options use for Container instances.
 * @memberof scene
 * @see scene.Container
 */
export interface ContainerOptions<T extends View> extends PixiMixins.ContainerOptions
{
    /** @see scene.Container#isRenderGroup */
    isRenderGroup?: boolean;
    /** @see scene.Container#view */
    view?: T;

    /** @see scene.Container#blendMode */
    blendMode?: BLEND_MODES;
    /** @see scene.Container#tint */
    tint?: ColorSource;

    /** @see scene.Container#alpha */
    alpha?: number;
    /** @see scene.Container#angle */
    angle?: number;
    /** @see scene.Container#children */
    children?: Container[];
    /** @see scene.Container#parent */
    parent?: Container;
    /** @see scene.Container#renderable */
    renderable?: boolean;
    /** @see scene.Container#rotation */
    rotation?: number;
    /** @see scene.Container#scale */
    scale?: PointData;
    /** @see scene.Container#pivot */
    pivot?: PointData;
    /** @see scene.Container#position */
    position?: PointData;
    /** @see scene.Container#skew */
    skew?: PointData;
    /** @see scene.Container#visible */
    visible?: boolean;
    /** @see scene.Container#x */
    x?: number;
    /** @see scene.Container#y */
    y?: number;
    /** @see scene.Container#boundArea */
    boundsArea?: Rectangle;
}

export interface Container
    extends Omit<PixiMixins.Container, keyof EventEmitter<ContainerEvents & AnyEvent>>,
    EventEmitter<ContainerEvents & AnyEvent> {}

/**
 * Container is a general-purpose display object that holds children. It also adds built-in support for advanced
 * rendering features like masking and filtering.
 *
 * It is the base class of all display objects that act as a container for other objects, including Graphics
 * and Sprite.
 *
 * ## Transforms
 *
 * The [transform]{@link scene.Container#transform} of a display object describes the projection from its
 * local coordinate space to its parent's local coordinate space. The following properties are derived
 * from the transform:
 *
 * <table>
 *   <thead>
 *     <tr>
 *       <th>Property</th>
 *       <th>Description</th>
 *     </tr>
 *   </thead>
 *   <tbody>
 *     <tr>
 *       <td>[pivot]{@link scene.Container#pivot}</td>
 *       <td>
 *         Invariant under rotation, scaling, and skewing. The projection of into the parent's space of the pivot
 *         is equal to position, regardless of the other three transformations. In other words, It is the center of
 *         rotation, scaling, and skewing.
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[position]{@link scene.Container#position}</td>
 *       <td>
 *         Translation. This is the position of the [pivot]{@link scene.Container#pivot} in the parent's local
 *         space. The default value of the pivot is the origin (0,0). If the top-left corner of your display object
 *         is (0,0) in its local space, then the position will be its top-left corner in the parent's local space.
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[scale]{@link scene.Container#scale}</td>
 *       <td>
 *         Scaling. This will stretch (or compress) the display object's projection. The scale factors are along the
 *         local coordinate axes. In other words, the display object is scaled before rotated or skewed. The center
 *         of scaling is the [pivot]{@link scene.Container#pivot}.
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[rotation]{@link scene.Container#rotation}</td>
 *       <td>
 *          Rotation. This will rotate the display object's projection by this angle (in radians).
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[skew]{@link scene.Container#skew}</td>
 *       <td>
 *         <p>Skewing. This can be used to deform a rectangular display object into a parallelogram.</p>
 *         <p>
 *         In PixiJS, skew has a slightly different behaviour than the conventional meaning. It can be
 *         thought of the net rotation applied to the coordinate axes (separately). For example, if "skew.x" is
 *         ⍺ and "skew.y" is β, then the line x = 0 will be rotated by ⍺ (y = -x*cot⍺) and the line y = 0 will be
 *         rotated by β (y = x*tanβ). A line y = x*tanϴ (i.e. a line at angle ϴ to the x-axis in local-space) will
 *         be rotated by an angle between ⍺ and β.
 *         </p>
 *         <p>
 *         It can be observed that if skew is applied equally to both axes, then it will be equivalent to applying
 *         a rotation. Indeed, if "skew.x" = -ϴ and "skew.y" = ϴ, it will produce an equivalent of "rotation" = ϴ.
 *         </p>
 *         <p>
 *         Another quite interesting observation is that "skew.x", "skew.y", rotation are commutative operations. Indeed,
 *         because rotation is essentially a careful combination of the two.
 *         </p>
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[angle]{@link scene.Container#angle}</td>
 *       <td>Rotation. This is an alias for [rotation]{@link scene.Container#rotation}, but in degrees.</td>
 *     </tr>
 *     <tr>
 *       <td>[x]{@link scene.Container#x}</td>
 *       <td>Translation. This is an alias for position.x!</td>
 *     </tr>
 *     <tr>
 *       <td>[y]{@link scene.Container#y}</td>
 *       <td>Translation. This is an alias for position.y!</td>
 *     </tr>
 *     <tr>
 *       <td>[width]{@link scene.Container#width}</td>
 *       <td>
 *         Implemented in [Container]{@link scene.Container}. Scaling. The width property calculates scale.x by dividing
 *         the "requested" width by the local bounding box width. It is indirectly an abstraction over scale.x, and there
 *         is no concept of user-defined width.
 *       </td>
 *     </tr>
 *     <tr>
 *       <td>[height]{@link scene.Container#height}</td>
 *       <td>
 *         Implemented in [Container]{@link scene.Container}. Scaling. The height property calculates scale.y by dividing
 *         the "requested" height by the local bounding box height. It is indirectly an abstraction over scale.y, and there
 *         is no concept of user-defined height.
 *       </td>
 *     </tr>
 *   </tbody>
 * </table>
 *
 * ## Bounds
 *
 * TODO
 *
 * ## Alpha
 *
 * This alpha sets a display object's **relative opacity** w.r.t its parent. For example, if the alpha of a display
 * object is 0.5 and its parent's alpha is 0.5, then it will be rendered with 25% opacity (assuming alpha is not
 * applied on any ancestor further up the chain).
 *
 * ## Renderable vs Visible
 *
 * The `renderable` and `visible` properties can be used to prevent a display object from being rendered to the
 * screen. However, there is a subtle difference between the two. When using `renderable`, the transforms  of the display
 * object (and its children subtree) will continue to be calculated. When using `visible`, the transforms will not
 * be calculated.
 * @example
 * import { BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
 *
 * const container = new Container();
 * const sprite = Sprite.from('https://s3-us-west-2.amazonaws.com/s.cdpn.io/693612/IaUrttj.png');
 *
 * sprite.width = 512;
 * sprite.height = 512;
 *
 * // Adds a sprite as a child to this container. As a result, the sprite will be rendered whenever the container
 * // is rendered.
 * container.addChild(sprite);
 *
 * // Blurs whatever is rendered by the container
 * container.filters = [new BlurFilter()];
 *
 * // Only the contents within a circle at the center should be rendered onto the screen.
 * container.mask = new Graphics()
 *     .beginFill(0xffffff)
 *     .drawCircle(sprite.width / 2, sprite.height / 2, Math.min(sprite.width, sprite.height) / 2)
 *     .endFill();
 *
 *
 * ## RenderGroup
 *
 * In PixiJS v8, containers can be set to operate in 'render group mode',
 * transforming them into entities akin to a stage in traditional rendering paradigms.
 * A render group is a root renderable entity, similar to a container,
 * but it's rendered in a separate pass with its own unique set of rendering instructions.
 * This approach enhances rendering efficiency and organization, particularly in complex scenes.
 *
 * You can enable render group mode on any container using container.enableRenderGroup()
 * or by initializing a new container with the render group property set to true (new Container({isRenderGroup: true})).
 *  The method you choose depends on your specific use case and setup requirements.
 *
 * An important aspect of PixiJS’s rendering process is the automatic treatment of rendered scenes as render groups.
 * This conversion streamlines the rendering process, but understanding when and how this happens is crucial
 * to fully leverage its benefits.
 *
 * One of the key advantages of using render groups is the performance efficiency in moving them. Since transformations
 *  are applied at the GPU level, moving a render group, even one with complex and numerous children,
 * doesn't require recalculating the rendering instructions or performing transformations on each child.
 * This makes operations like panning a large game world incredibly efficient.
 *
 * However, it's crucial to note that render groups do not batch together.
 * This means that turning every container into a render group could actually slow things down,
 * as each render group is processed separately. It's best to use render groups judiciously, at a broader level,
 * rather than on a per-child basis.
 * This approach ensures you get the performance benefits without overburdening the rendering process.
 *
 * RenderGroups maintain their own set of rendering instructions,
 * ensuring that changes or updates within a render group don't affect the rendering
 * instructions of its parent or other render groups.
 *  This isolation ensures more stable and predictable rendering behavior.
 *
 * Additionally, renderGroups can be nested, allowing for powerful options in organizing different aspects of your scene.
 * This feature is particularly beneficial for separating complex game graphics from UI elements,
 * enabling intricate and efficient scene management in complex applications.
 *
 * This means that Containers have 3 levels of matrix to be mindful of:
 *
 * 1 - localTransform, this is the transform of the container based on its own properties
 * 2 - rgTransform, this it the transform of the container relative to the renderGroup it belongs too
 * 3 - worldTransform, this is the transform of the container relative to the Scene being rendered
 * @memberof scene
 */
export class Container<T extends View = View> extends EventEmitter<ContainerEvents & AnyEvent> implements Renderable
{
    /**
     * Mixes all enumerable properties and methods from a source object to Container.
     * @param source - The source of properties and methods to mix in.
     */
    public static mixin(source: Dict<any>): void
    {
        Object.defineProperties(Container.prototype, Object.getOwnPropertyDescriptors(source));
    }

    /** @private */
    public uid: number = uid('renderable');

    /** @private */
    public _updateFlags = 0b1111;

    // is this container the root of a renderGroup?
    // TODO implement this in a few more places
    /** @private */
    public isRenderGroupRoot = false;
    // the render group this container belongs to OR owns
    /** @private */
    public renderGroup: RenderGroup = null;

    // set to true if the container has changed. It is reset once the changes have been applied
    // by the transform system
    // its here to stop ensure that when things change, only one update gets registers with the transform system
    /** @private */
    public didChange = false;
    // same as above, but for the renderable
    /** @private */
    public didViewUpdate = false;
    // how deep is the container relative to its render group..
    // unless the element is the root render group - it will be relative to its parent
    /** @private */
    public relativeRenderGroupDepth = 0;

    /**
     * The array of children of this container.
     * @readonly
     */
    public children: Container[] = [];
    /** The display object container that contains this display object. */
    public parent: Container = null;

    // used internally for changing up the render order.. mainly for masks and filters
    // TODO setting this should cause a rebuild??
    /** @private */
    public includeInBuild = true;
    /** @private */
    public measurable = true;
    /** @private */
    public isSimple = true;

    /// /////////////Transform related props//////////////

    // used by the transform system to check if a container needs to be updated that frame
    // if the tick matches the current transform system tick, it is not updated again
    /**
     * @internal
     * @ignore
     */
    public updateTick = -1;

    /**
     * Current transform of the object based on local factors: position, scale, other stuff.
     * @readonly
     */
    public localTransform: Matrix = new Matrix();
    /**
     * The render group transform is a transform relative to the render group it belongs too. It will include all parent
     * transforms and up to the render group (think of it as kind of like a stage - but the stage can be nested).
     * @readonly
     */
    public rgTransform: Matrix = new Matrix();
    // the global transform taking into account the render group and all parents
    private _worldTransform: Matrix;

    /** If the object has been destroyed via destroy(). If true, it should not be used. */
    public destroyed = false;

    // transform data..
    /**
     * The coordinate of the object relative to the local coordinates of the parent.
     * @internal
     * @ignore
     */
    public _position: ObservablePoint = new ObservablePoint(this, 0, 0);

    /**
     * The scale factor of the object.
     * @internal
     * @ignore
     */
    public _scale: ObservablePoint = defaultScale;

    /**
     * The pivot point of the container that it rotates around.
     * @internal
     * @ignore
     */
    public _pivot: ObservablePoint = defaultPivot;

    /**
     * The skew amount, on the x and y axis.
     * @internal
     * @ignore
     */
    public _skew: ObservablePoint = defaultSkew;

    /**
     * The X-coordinate value of the normalized local X axis,
     * the first column of the local transformation matrix without a scale.
     * @internal
     * @ignore
     */
    public _cx = 1;

    /**
     * The Y-coordinate value of the normalized local X axis,
     * the first column of the local transformation matrix without a scale.
     * @internal
     * @ignore
     */
    public _sx = 0;

    /**
     * The X-coordinate value of the normalized local Y axis,
     * the second column of the local transformation matrix without a scale.
     * @internal
     * @ignore
     */
    public _cy = 0;

    /**
     * The Y-coordinate value of the normalized local Y axis,
     * the second column of the local transformation matrix without a scale.
     * @internal
     * @ignore
     */
    public _sy = 1;

    /** The rotation amount. */
    private _rotation = 0;

    /// COLOR related props //////////////

    // color stored as ABGR
    /**
     * @internal
     * @ignore
     */
    public localColor = 0xFFFFFF;
    public localAlpha = 1;

    /**
     * @internal
     * @ignore
     */
    public rgAlpha = 1; // A
    public rgColor = 0xFFFFFF; // BGR
    public rgColorAlpha = 0xFFFFFFFF; // ABGR

    /// BLEND related props //////////////

    /**
     * @internal
     * @ignore
     */
    public localBlendMode: BLEND_MODES = 'inherit';
    /**
     * @internal
     * @ignore
     */
    public rgBlendMode: BLEND_MODES = 'normal';

    /// VISIBILITY related props //////////////

    // visibility
    // 0b11
    // first bit is visible, second bit is renderable
    /**
     * @internal
     * @ignore
     */
    public localVisibleRenderable = 0b11; // 0b11 | 0b10 | 0b01 | 0b00
    /**
     * @internal
     * @ignore
     */
    public rgVisibleRenderable = 0b11; // 0b11 | 0b10 | 0b01 | 0b00

    /** A view that is used to render this container. */
    public readonly view: T;

    /**
     * An optional bounds area for this container. Setting this rectangle will stop the renderer
     * from recursively measuring the bounds of each children and instead use this single boundArea.
     * This is great for optimisation! If for example you have a 1000 spinning particles and you know they all sit
     * within a specific bounds, then setting it will mean the renderer will not need to measure the
     * 1000 children to find the bounds. Instead it will just use the bounds you set.
     */
    public boundsArea: Rectangle;

    constructor(options: Partial<ContainerOptions<T>> = {})
    {
        super();

        if (options.view)
        {
            this.view = options.view;
            // in the future we could de-couple container and view..
            // but for now this is just faster!
            this.view.owner = this;
            options.view = undefined;
        }

        assignWithIgnore(this, options, {
            children: true,
            parent: true,
            effects: true,
        });

        options.children?.forEach((child) => this.addChild(child));
        this.effects = [];
        options.parent?.addChild(this);
    }

    /**
     * Adds one or more children to the container.
     *
     * Multiple items can be added like so: `myContainer.addChild(thingOne, thingTwo, thingThree)`
     * @param {...Container} children - The Container(s) to add to the container
     * @returns {Container} - The first child that was added.
     */
    public addChild<U extends Container[]>(...children: U): U[0]
    {
        if (!this.allowChildren)
        {
            deprecation(v8_0_0, 'addChild: Only Containers will be allowed to add children in v8.0.0');
        }

        if (children.length > 1)
        {
            // loop through the array and add all children
            for (let i = 0; i < children.length; i++)
            {
                this.addChild(children[i]);
            }

            return children[0];
        }

        const child = children[0];

        if (child.parent === this)
        {
            this.children.splice(this.children.indexOf(child), 1);
            this.children.push(child);

            if (this.renderGroup && !this.isRenderGroupRoot)
            {
                this.renderGroup.structureDidChange = true;
            }

            return child;
        }

        if (child.parent)
        {
            // TODO Optimisation...if the parent has the same render group, this does not need to change!
            child.parent.removeChild(child);
        }

        this.children.push(child);

        if (this.sortableChildren) this.sortDirty = true;

        child.parent = this;

        child.didChange = true;
        child.didViewUpdate = false;

        // TODO - OPtimise this? could check what the parent has set?
        child._updateFlags = 0b1111;

        if (this.renderGroup)
        {
            this.renderGroup.addChild(child);
        }

        this.emit('childAdded', child, this, this.children.length - 1);
        child.emit('added', this);

        if (child._zIndex !== 0)
        {
            child.depthOfChildModified();
        }

        return child;
    }

    /**
     * Removes one or more children from the container.
     * @param {...Container} children - The Container(s) to remove
     * @returns {Container} The first child that was removed.
     */
    public removeChild<U extends Container[]>(...children: U): U[0]
    {
        // if there is only one argument we can bypass looping through the them
        if (children.length > 1)
        {
            // loop through the arguments property and remove all children
            for (let i = 0; i < children.length; i++)
            {
                this.removeChild(children[i]);
            }

            return children[0];
        }

        const child = children[0];

        const index = this.children.indexOf(child);

        if (index > -1)
        {
            this.children.splice(index, 1);

            if (this.renderGroup)
            {
                this.renderGroup.removeChild(child);
            }
        }

        child.parent = null;
        this.emit('childRemoved', child, this, index);
        child.emit('removed', this);

        return child;
    }

    /** @ignore */
    public onUpdate(point?: ObservablePoint)
    {
        if (point)
        {
            //   this.updateFlags |= UPDATE_TRANSFORM;

            if (point === this._skew)
            {
                this._updateSkew();
            }
        }

        if (this.didChange) return;
        this.didChange = true;

        if (this.isRenderGroupRoot)
        {
            const renderGroupParent = this.renderGroup.renderGroupParent;
            // lets update its parent..

            if (renderGroupParent)
            {
                renderGroupParent.onChildUpdate(this);
            }
        }
        else if (this.renderGroup)
        {
            this.renderGroup.onChildUpdate(this);
        }
    }

    /** @ignore */
    public onViewUpdate()
    {
        if (this.didViewUpdate) return;
        this.didViewUpdate = true;

        if (this.renderGroup)
        {
            this.renderGroup.onChildViewUpdate(this);
        }
    }

    set isRenderGroup(value: boolean)
    {
        if (this.isRenderGroupRoot && value === false)
        {
            throw new Error('[Pixi] cannot undo a render group just yet');
        }

        if (value)
        {
            this.enableRenderGroup();
        }
    }

    /**
     * Returns true if this container is a render group.
     * This means that it will be rendered as a separate pass, with its own set of instructions
     */
    get isRenderGroup(): boolean
    {
        return this.isRenderGroupRoot;
    }

    /** This enables the container to be rendered as a render group. */
    public enableRenderGroup()
    {
        // does it OWN the render group..
        if (this.renderGroup && this.renderGroup.root === this) return;

        this.isRenderGroupRoot = true;

        const parentRenderGroup = this.renderGroup;

        if (parentRenderGroup)
        {
            parentRenderGroup.removeChild(this);
        }

        this.renderGroup = new RenderGroup(this);

        // find children render groups and move them out..
        if (parentRenderGroup)
        {
            for (let i = 0; i < parentRenderGroup.renderGroupChildren.length; i++)
            {
                const childRenderGroup = parentRenderGroup.renderGroupChildren[i];
                let parent = childRenderGroup.root;

                while (parent)
                {
                    if (parent === this)
                    {
                        this.renderGroup.addRenderGroupChild(childRenderGroup);

                        break;
                    }
                    parent = parent.parent;
                }
            }

            parentRenderGroup.addRenderGroupChild(this.renderGroup);
        }

        this._updateIsSimple();
    }

    /** @ignore */
    public _updateIsSimple()
    {
        this.isSimple = !(this.isRenderGroupRoot) && (this.effects.length === 0);
    }

    /**
     * Current transform of the object based on world (parent) factors.
     * @readonly
     */
    get worldTransform()
    {
        this._worldTransform ||= new Matrix();

        if (this.renderGroup)
        {
            if (this.isRenderGroupRoot)
            {
                this._worldTransform.copyFrom(this.renderGroup.worldTransform);
            }
            else
            {
                this._worldTransform.appendFrom(this.rgTransform, this.renderGroup.worldTransform);
            }
        }

        return this._worldTransform;
    }

    /// ////// transform related stuff

    /**
     * The position of the container on the x axis relative to the local coordinates of the parent.
     * An alias to position.x
     */
    get x(): number
    {
        return this._position.x;
    }

    set x(value: number)
    {
        this._position.x = value;
    }

    /**
     * The position of the container on the y axis relative to the local coordinates of the parent.
     * An alias to position.y
     */
    get y(): number
    {
        return this._position.y;
    }

    set y(value: number)
    {
        this._position.y = value;
    }

    /**
     * The coordinate of the object relative to the local coordinates of the parent.
     * @since 4.0.0
     */
    get position(): ObservablePoint
    {
        return this._position;
    }

    set position(value: PointData)
    {
        this._position.copyFrom(value);
    }

    /**
     * The rotation of the object in radians.
     * 'rotation' and 'angle' have the same effect on a display object; rotation is in radians, angle is in degrees.
     */
    get rotation(): number
    {
        return this._rotation;
    }

    set rotation(value: number)
    {
        if (this._rotation !== value)
        {
            this._rotation = value;
            this.onUpdate(this._skew);
        }
    }

    /**
     * The angle of the object in degrees.
     * 'rotation' and 'angle' have the same effect on a display object; rotation is in radians, angle is in degrees.
     */
    get angle(): number
    {
        return this.rotation * RAD_TO_DEG;
    }

    set angle(value: number)
    {
        this.rotation = value * DEG_TO_RAD;
    }

    /**
     * The center of rotation, scaling, and skewing for this display object in its local space. The `position`
     * is the projection of `pivot` in the parent's local space.
     *
     * By default, the pivot is the origin (0, 0).
     * @since 4.0.0
     */
    get pivot(): ObservablePoint
    {
        if (this._pivot === defaultPivot)
        {
            this._pivot = new ObservablePoint(this, 0, 0);
        }

        return this._pivot;
    }

    set pivot(value: PointData)
    {
        if (this._pivot === defaultPivot)
        {
            this._pivot = new ObservablePoint(this, 0, 0);
        }

        this._pivot.copyFrom(value);
    }

    /**
     * The skew factor for the object in radians.
     * @since 4.0.0
     */
    get skew(): ObservablePoint
    {
        if (this._skew === defaultSkew)
        {
            this._skew = new ObservablePoint(this, 0, 0);
        }

        return this._skew;
    }

    /**
     * The scale factors of this object along the local coordinate axes.
     *
     * The default scale is (1, 1).
     * @since 4.0.0
     */
    get scale(): ObservablePoint
    {
        if (this._scale === defaultScale)
        {
            this._scale = new ObservablePoint(this, 1, 1);
        }

        return this._scale;
    }

    set scale(value: PointData)
    {
        if (this._scale === defaultScale)
        {
            this._scale = new ObservablePoint(this, 0, 0);
        }

        this._scale.copyFrom(value);
    }

    /** Called when the skew or the rotation changes. */
    private _updateSkew(): void
    {
        const rotation = this._rotation;
        const skew = this._skew;

        this._cx = Math.cos(rotation + skew._y);
        this._sx = Math.sin(rotation + skew._y);
        this._cy = -Math.sin(rotation - skew._x); // cos, added PI/2
        this._sy = Math.cos(rotation - skew._x); // sin, added PI/2
    }

    /// ///// color related stuff

    set alpha(value: number)
    {
        if (value === this.localAlpha) return;

        this.localAlpha = value;

        this._updateFlags |= UPDATE_COLOR;

        this.onUpdate();
    }

    /** The opacity of the object. */
    get alpha(): number
    {
        return this.localAlpha;
    }

    set tint(value: ColorSource)
    {
        const tempColor = Color.shared.setValue(value ?? 0xFFFFFF);
        const bgr = tempColor.toBgrNumber();

        if (bgr === this.localColor) return;

        this.localColor = bgr;

        this._updateFlags |= UPDATE_COLOR;

        this.onUpdate();
    }

    /**
     * The tint applied to the sprite. This is a hex value.
     *
     * A value of 0xFFFFFF will remove any tint effect.
     * @default 0xFFFFFF
     */
    get tint(): number
    {
        const bgr = this.localColor;
        // convert bgr to rgb..

        return ((bgr & 0xFF) << 16) + (bgr & 0xFF00) + ((bgr >> 16) & 0xFF);
    }

    /// //////////////// blend related stuff

    set blendMode(value: BLEND_MODES)
    {
        if (this.localBlendMode === value) return;
        if (this.renderGroup && !this.isRenderGroupRoot)
        {
            this.renderGroup.structureDidChange = true;
        }

        this._updateFlags |= UPDATE_BLEND;

        this.localBlendMode = value;

        this.onUpdate();
    }

    /**
     * The blend mode to be applied to the sprite. Apply a value of `'normal'` to reset the blend mode.
     * @default 'normal'
     */
    get blendMode(): BLEND_MODES
    {
        return this.localBlendMode;
    }

    /// ///////// VISIBILITY / RENDERABLE /////////////////

    /** The visibility of the object. If false the object will not be drawn, and the transform will not be updated. */
    get visible()
    {
        return !!(this.localVisibleRenderable & 0b10);
    }

    set visible(value: boolean)
    {
        const valueNumber = value ? 1 : 0;

        if ((this.localVisibleRenderable & 0b10) >> 1 === valueNumber) return;

        if (this.renderGroup && !this.isRenderGroupRoot)
        {
            this.renderGroup.structureDidChange = true;
        }

        this._updateFlags |= UPDATE_VISIBLE;

        this.localVisibleRenderable = (this.localVisibleRenderable & 0b01) | (valueNumber << 1);

        this.onUpdate();
    }

    /** Can this object be rendered, if false the object will not be drawn but the transform will still be updated. */
    get renderable()
    {
        return !!(this.localVisibleRenderable & 0b01);
    }

    set renderable(value: boolean)
    {
        const valueNumber = value ? 1 : 0;

        if ((this.localVisibleRenderable & 0b01) === valueNumber) return;

        this.localVisibleRenderable = (this.localVisibleRenderable & 0b10) | valueNumber;

        this._updateFlags |= UPDATE_VISIBLE;

        if (this.renderGroup && !this.isRenderGroupRoot)
        {
            this.renderGroup.structureDidChange = true;
        }

        this.onUpdate();
    }

    /** Whether or not the object should be rendered. */
    get isRenderable(): boolean
    {
        return (this.localVisibleRenderable === 0b11 && this.rgAlpha > 0);
    }

    /**
     * Removes all internal references and listeners as well as removes children from the display list.
     * Do not use a Container after calling `destroy`.
     * @param options - Options parameter. A boolean will act as if all options
     *  have been set to that value
     * @param {boolean} [options.children=false] - if set to true, all the children will have their destroy
     *  method called as well. 'options' will be passed on to those calls.
     * @param {boolean} [options.texture=false] - Only used for children with textures e.g. Sprites. If options.children
     * is set to true it should destroy the texture of the child sprite
     * @param {boolean} [options.textureSource=false] - Only used for children with textures e.g. Sprites.
     * If options.children is set to true it should destroy the texture source of the child sprite
     * @param {boolean} [options.context=false] - Only used for children with graphicsContexts e.g. Graphics.
     * If options.children is set to true it should destroy the context of the child graphics
     */
    public destroy(options: DestroyOptions = false): void
    {
        if (this.destroyed) return;
        this.destroyed = true;

        this.removeFromParent();
        this.parent = null;
        this._mask = null;
        this._filters = null;
        this.effects = null;
        this._position = null;
        this._scale = null;
        this._pivot = null;
        this._skew = null;

        if (this.isRenderGroupRoot)
        {
            this.renderGroup.proxyRenderable = null;
        }

        this.emit('destroyed');

        this.removeAllListeners();

        const destroyChildren = typeof options === 'boolean' ? options : options?.children;

        const oldChildren = this.removeChildren(0, this.children.length);

        if (destroyChildren)
        {
            for (let i = 0; i < oldChildren.length; ++i)
            {
                oldChildren[i].destroy(options);
            }
        }

        if (this.view)
        {
            this.view.destroy(options);
            this.view.owner = null;
        }
    }
}

Container.mixin(childrenHelperMixin);
Container.mixin(toLocalGlobalMixin);
Container.mixin(onRenderMixin);
Container.mixin(measureMixin);
Container.mixin(effectsMixin);
Container.mixin(findMixin);
Container.mixin(sortMixin);
