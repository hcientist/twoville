import { 
  FunctionDefinition,
  LocatedException,
  SourceLocation,
  Turtle,
  mop,
  svgNamespace,
} from './common.js';

import {
  TimelinedEnvironment,
  Mirror,
  Stroke,
} from './environment.js';

import {
  CircleMark,
  HorizontalPanMark,
  Marker,
  PathMark,
  PolygonMark,
  PolylineMark,
  RectangleMark,
  VectorPanMark,
  VerticalPanMark,
} from './mark.js';

import {
  Matrix,
} from './transform.js';

import {
  VertexNode,
} from './node.js';

import {
  ExpressionBoolean,
  ExpressionInteger,
  ExpressionJumpNode,
  ExpressionLineNode,
  ExpressionMoveNode,
  ExpressionArcNode,
  ExpressionCubicNode,
  ExpressionQuadraticNode,
  ExpressionReal,
  ExpressionString,
  ExpressionTranslate,
  ExpressionRotate,
  ExpressionScale,
  ExpressionShear,
  ExpressionTurnNode,
  ExpressionTurtleNode,
  ExpressionVector,
  ExpressionVertexNode,
} from './ast.js';

// --------------------------------------------------------------------------- 

export class Shape extends TimelinedEnvironment {
  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.id = this.root.serial;
    this.untimedProperties.stroke = Stroke.create(this);
    this.untimedProperties.stroke.bind('opacity', new ExpressionReal(1));
    this.sourceSpans = [];
    this.transforms = [];

    this.bind('opacity', new ExpressionReal(1));
    this.bindFunction('translate', new FunctionDefinition('translate', [], new ExpressionTranslate(this)));
    this.bindFunction('scale', new FunctionDefinition('scale', [], new ExpressionScale(this)));
    this.bindFunction('rotate', new FunctionDefinition('rotate', [], new ExpressionRotate(this)));
    this.bindFunction('shear', new FunctionDefinition('shear', [], new ExpressionShear(this)));

    this.root.serial += 1;
    this.root.shapes.push(this);
  }

  toPod() {
    const pod = super.toPod();
    pod.id = this.id;
    pod.sourceSpans = this.sourceSpans;
    pod.transforms = this.transforms.map(transform => transform.toPod());
    return pod;
  }

  embody(parentEnvironment, pod) {
    super.embody(parentEnvironment, pod);
    this.id = pod.id;
    this.sourceSpans = pod.sourceSpans.map(subpod => SourceLocation.reify(subpod));
    this.transforms = pod.transforms.map(subpod => this.root.omniReify(this, subpod));
  }

  static reify(parentEnvironment, pod) {
    if (pod.type === 'rectangle') {
      return Rectangle.reify(parentEnvironment, pod);
    } else if (pod.type === 'circle') {
      return Circle.reify(parentEnvironment, pod);
    } else if (pod.type === 'polygon') {
      return Polygon.reify(parentEnvironment, pod);
    } else if (pod.type === 'polyline') {
      return Polyline.reify(parentEnvironment, pod);
    } else if (pod.type === 'ungon') {
      return Ungon.reify(parentEnvironment, pod);
    } else if (pod.type === 'line') {
      return Line.reify(parentEnvironment, pod);
    } else if (pod.type === 'text') {
      return Text.reify(parentEnvironment, pod);
    } else if (pod.type === 'path') {
      return Path.reify(parentEnvironment, pod);
    } else if (pod.type === 'group') {
      return Group.reify(parentEnvironment, pod);
    } else {
      throw new Error(`unimplemented shape: ${pod.type}`);
    }
  }

  show() {
    this.element.setAttributeNS(null, 'visibility', 'visible');
  }

  hide() {
    this.element.setAttributeNS(null, 'visibility', 'hidden');
  }

  start() {
    this.markers = [];
    this.addMarker(new Marker(this));
    for (let transform of this.transforms) {
      transform.start();
    }
  }

  addMarker(marker) {
    marker.id = this.markers.length;
    this.markers.push(marker);
  }

  validate() {
    for (let transform of this.transforms) {
      transform.validate();
    }
  }

  scrub(env, t, bounds) {
    const centroid = this.updateProperties(env, t, bounds, Matrix.identity());
  }

  transform(env, t, bounds, matrix) {
    if (this.transforms.length > 0) {
      let commands = [];
      for (let transform of this.transforms) {
        const transformation = transform.updateProperties(env, t, bounds, matrix);
        matrix = transformation.matrix;
        commands.push(...transformation.commands);
      }

      const commandString = commands.join(' ');
      this.element.setAttributeNS(null, 'transform', commandString);
      this.backgroundMarkGroup.setAttributeNS(null, 'transform', commandString);
    }

    return matrix;
  }
  
  updateCentroid(matrix, centroid, bounds) {
    const p = matrix.multiplyVector(centroid);
    // Have to flip Y because we've already countered the axis.
    this.centeredForegroundMarkGroup.setAttributeNS(null, 'transform', `translate(${p.get(0).value} ${-p.get(1).value})`);
  }

  updateProperties(env, t, bounds, matrix) {
    throw Error('Shape.updateProperties is abstract');
    // Step 1. Transform.
    // Step 2. Update properties.
    // Step 3. Fix marks that depend on centroid.
  }

  connect() {
    // TODO assert that parent is a group
    if (this.owns('parent')) {
      this.parentElement = this.get('parent').element;
      this.get('parent').children.push(this);
      this.isDrawable = false;
    } else if (this.owns('template') && this.get('template').value) {
      this.parentElement = this.root.defines;
      this.isDrawable = false;
    } else {
      this.parentElement = this.root.mainGroup;
      this.isDrawable = true;
    }

    if (this.owns('mask')) {
      const mask = this.get('mask');
      const maskParent = document.createElementNS(svgNamespace, 'g');
      maskParent.setAttributeNS(null, 'mask', 'url(#element-' + mask.id + ')');
      maskParent.appendChild(this.element);
      this.parentElement.appendChild(maskParent);
    } else {
      this.parentElement.appendChild(this.element);
    }

    this.initializeMarks();
  }

  select() {
    this.isSelected = true;
    this.markers[0].select();
  }

  deselect() {
    this.isSelected = false;
    this.selectedMarker = undefined;
    this.markers[0].deselect();
  }

  initializeMarks() {
    this.backgroundMarkGroup = document.createElementNS(svgNamespace, 'g');
    this.backgroundMarkGroup.setAttributeNS(null, 'id', `element-${this.id}-background-marks`);

    this.midgroundMarkGroup = document.createElementNS(svgNamespace, 'g');
    this.midgroundMarkGroup.setAttributeNS(null, 'id', `element-${this.id}-midground-marks`);

    this.foregroundMarkGroup = document.createElementNS(svgNamespace, 'g');
    this.foregroundMarkGroup.setAttributeNS(null, 'id', `element-${this.id}-foreground-marks`);

    this.centeredForegroundMarkGroup = document.createElementNS(svgNamespace, 'g');
    this.centeredForegroundMarkGroup.setAttributeNS(null, 'id', `element-${this.id}-centered-foreground-marks`);

    this.element.classList.add('cursor-selectable');
    this.element.classList.add(`tag-${this.id}`);

    if (this.owns('parent')) {
      this.get('parent').backgroundMarkGroup.appendChild(this.backgroundMarkGroup);
      this.get('parent').midgroundMarkGroup.appendChild(this.midgroundMarkGroup);
      this.get('parent').foregroundMarkGroup.appendChild(this.foregroundMarkGroup);
      this.get('parent').centeredForegroundMarkGroup.appendChild(this.centeredForegroundMarkGroup);
    } else {
      this.root.backgroundMarkGroup.appendChild(this.backgroundMarkGroup);
      this.root.midgroundMarkGroup.appendChild(this.midgroundMarkGroup);
      this.root.foregroundMarkGroup.appendChild(this.foregroundMarkGroup);
      this.root.centeredForegroundMarkGroup.appendChild(this.centeredForegroundMarkGroup);
    }

    this.element.addEventListener('click', event => {
      // If the event bubbles up to the parent SVG, that means no shape was
      // clicked on, and everything will be deselected. We don't want that.
      event.stopPropagation();

      if (!this.root.isStale) {
        this.root.select(this);
      }
    });

    this.element.addEventListener('mouseenter', event => {
      if (this.root.isTweaking) return;

      event.stopPropagation();

      // Only show the marks if the source code is evaluated and fresh.
      if (!this.isSelected && !this.root.isStale) {
        this.markers[0].hoverMarks();
      }

      if (event.buttons === 0) {
        this.root.contextualizeCursor(event.toElement);
      }
    });

    this.element.addEventListener('mouseleave', event => {
      event.stopPropagation();

      if (this.markers[0].isUnhoverTransition(event)) {
        this.markers[0].unhoverMarks();
      }

      if (event.buttons === 0) {
        this.root.contextualizeCursor(event.toElement);
      }
    });

    for (let marker of this.markers) {
      this.backgroundMarkGroup.appendChild(marker.backgroundMarkGroup);
      this.midgroundMarkGroup.appendChild(marker.midgroundMarkGroup);
      this.foregroundMarkGroup.appendChild(marker.foregroundMarkGroup);
      this.centeredForegroundMarkGroup.appendChild(marker.centeredForegroundMarkGroup);
    }
  }

  selectMarker(id) {
    if (id >= this.markers.length) return;

    for (let marker of this.markers) {
      marker.hideMarks();
    }

    this.selectedMarker = this.markers[id];
    this.markers[0].showBackgroundMarks();
    this.markers[id].select();
  }

  castCursor(column, row) {
    let isHit = this.castCursorIntoComponents(column, row); 
    if (!isHit) {
      isHit = this.sourceSpans.some(span => span.contains(column, row));
      if (isHit) {
        if (this.isSelected) {
          this.selectMarker(0);
        } else {
          this.root.select(this);
        }
      }
    }
    return isHit;
  }

  castCursorIntoComponents(column, row) {
    for (let transform of this.transforms) {
      if (transform.castCursor(column, row)) {
        return true;
      }
    }
    return false;
  }

  unscaleMarks(factor) {
    for (let marker of this.markers) {
      marker.unscale(factor);
    }
  }
}

// --------------------------------------------------------------------------- 

export class Text extends Shape {
  static type = 'text';
  static article = 'a';
  static timedIds = ['position', 'message', 'size', 'color', 'opacity', 'anchor', 'baseline'];

  static create(parentEnvironment, where) {
    const shape = new Text();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Text();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();
    this.element = document.createElementNS(svgNamespace, 'text');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);
    this.element.appendChild(document.createTextNode('...'));

    this.outlineMark = new RectangleMark();
    this.positionMark = new VectorPanMark(this);

    this.markers[0].addMarks([this.positionMark], [this.outlineMark]);

    this.connect();
  }

  validate() {
    super.validate();
    this.assertProperty('position');
    this.assertProperty('message');
    this.assertProperty('color');
    // TODO others?
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    let position = this.valueAt(env, 'position', t);
    this.positionMark.setExpression(position);

    let message = this.valueAt(env, 'message', t);
    let color = this.valueAt(env, 'color', t);

    let fontSize;
    if (this.owns('size')) {
      fontSize = this.valueAt(env, 'size', t);
    } else {
      fontSize = new ExpressionInteger(8);
    }

    let anchor;
    if (this.owns('anchor')) {
      anchor = this.valueAt(env, 'anchor', t);
    } else {
      anchor = new ExpressionString('middle');
    }

    let baseline;
    if (this.owns('baseline')) {
      baseline = this.valueAt(env, 'baseline', t);
    } else {
      baseline = new ExpressionString('center');
    }

    if (!position || !color) {
      this.hide();
      return null;
    } else {
      this.show();
      this.element.childNodes[0].nodeValue = message.value;
      this.element.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.element.setAttributeNS(null, 'x', position.get(0).value);
      this.element.setAttributeNS(null, 'y', bounds.span - position.get(1).value);
      this.element.setAttributeNS(null, 'fill', color.toColor());
      this.element.setAttributeNS(null, 'font-size', fontSize.value);
      this.element.setAttributeNS(null, 'text-anchor', anchor.value);
      this.element.setAttributeNS(null, 'dominant-baseline', baseline.value);

      // I have to query the SVG element to determine the bounding box of the
      // text.
      const box = this.element.getBBox();
      this.outlineMark.updateProperties(new ExpressionVector([
        new ExpressionReal(box.x),
        new ExpressionReal(bounds.span - box.y - box.height),
      ]), new ExpressionVector([
        new ExpressionReal(box.width),
        new ExpressionReal(box.height),
      ]), bounds, matrix);

      this.positionMark.updateProperties(position, bounds, matrix);

      const centroid = new ExpressionVector([
        new ExpressionReal(box.x + box.width * 0.5),
        new ExpressionReal(box.y + box.height * 0.5),
      ]);
      this.updateCentroid(matrix, centroid, bounds);

      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Rectangle extends Shape {
  static type = 'rectangle';
  static article = 'a';
  static timedIds = ['corner', 'center', 'size', 'color', 'opacity', 'rounding'];

  static create(parentEnvironment, where) {
    const shape = new Rectangle();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Rectangle();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();
    this.element = document.createElementNS(svgNamespace, 'rect');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.outlineMark = new RectangleMark();
    this.positionMark = new VectorPanMark(this);
    this.widthMark = new HorizontalPanMark(this, this, this.owns('center') ? 2 : 1);
    this.heightMark = new VerticalPanMark(this, this, this.owns('center') ? 2 : 1);

    this.markers[0].addMarks([this.positionMark, this.widthMark, this.heightMark], [this.outlineMark]);

    this.connect();
  }

  validate() {
    super.validate();

    if (this.owns('corner') && this.owns('center')) {
      throw new LocatedException(this.where, 'I found a rectangle whose corner and center properties were both set. Define only one of these.');
    }

    if (!this.owns('corner') && !this.owns('center')) {
      throw new LocatedException(this.where, 'I found a rectangle whose location I couldn\'t figure out. Please define its corner or center.');
    }
    
    this.assertProperty('color');
    this.assertProperty('size');
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const size = this.valueAt(env, 'size', t);
    this.widthMark.setExpression(size.get(0));
    this.heightMark.setExpression(size.get(1));

    let corner;
    let center;
    if (this.owns('corner')) {
      corner = this.valueAt(env, 'corner', t);
      this.positionMark.setExpression(corner);
    } else {
      center = this.valueAt(env, 'center', t);
      this.positionMark.setExpression(center);
      corner = new ExpressionVector([
        new ExpressionReal(center.get(0).value - size.get(0).value * 0.5),
        new ExpressionReal(center.get(1).value - size.get(1).value * 0.5),
      ]);
    }

    const opacity = this.valueAt(env, 'opacity', t).value;
    const isVisible = opacity > 0.000001;
    let color;
    if (isVisible) {
      color = this.valueAt(env, 'color', t);
    }

    if (!corner || !size || (!color && isVisible)) {
      this.hide();
    } else {
      this.show();

      let rounding;
      if (this.owns('rounding')) {
        rounding = this.valueAt(env, 'rounding', t);
        this.element.setAttributeNS(null, 'rx', rounding.value);
        this.element.setAttributeNS(null, 'ry', rounding.value);
      }

      if (this.owns('stroke')) {
        this.untimedProperties.stroke.applyStroke(env, t, this.element);
      }

      this.element.setAttributeNS(null, 'x', corner.get(0).value);
      this.element.setAttributeNS(null, 'y', bounds.span - size.get(1).value - corner.get(1).value);
      this.element.setAttributeNS(null, 'width', size.get(0).value);
      this.element.setAttributeNS(null, 'height', size.get(1).value);
      this.element.setAttributeNS(null, 'fill', isVisible ? color.toColor() : 'none');
      this.element.setAttributeNS(null, 'fill-opacity', opacity);

      this.outlineMark.updateProperties(corner, size, bounds, rounding, matrix);
      if (center) {
        this.positionMark.updateProperties(center, bounds, matrix);
        this.widthMark.updateProperties(new ExpressionVector([
          new ExpressionReal(center.get(0).value + size.get(0).value * 0.5),
          center.get(1)
        ]), bounds, matrix);
        this.heightMark.updateProperties(new ExpressionVector([
          center.get(0),
          new ExpressionReal(center.get(1).value + size.get(1).value * 0.5)
        ]), bounds, matrix);
      } else {
        this.positionMark.updateProperties(corner, bounds, matrix);
        this.widthMark.updateProperties(new ExpressionVector([
          new ExpressionReal(corner.get(0).value + size.get(0).value),
          corner.get(1)
        ]), bounds, matrix);
        this.heightMark.updateProperties(new ExpressionVector([
          corner.get(0),
          new ExpressionReal(corner.get(1).value + size.get(1).value)
        ]), bounds, matrix);
      }

      const centroid = corner.add(size.multiply(new ExpressionReal(0.5)));
      this.updateCentroid(matrix, centroid, bounds);
      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Circle extends Shape {
  static type = 'circle';
  static article = 'a';
  static timedIds = ['center', 'radius', 'color', 'opacity'];

  static create(parentEnvironment, where) {
    const shape = new Circle();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Circle();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();
    this.element = document.createElementNS(svgNamespace, 'circle');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.outlineMark = new CircleMark();
    this.centerMark = new VectorPanMark(this);
    this.radiusMark = new HorizontalPanMark(this);

    this.markers[0].addMarks([this.centerMark, this.radiusMark], [this.outlineMark]);
    this.connect();
  }

  validate() {
    super.validate();
    this.assertProperty('center');
    this.assertProperty('radius');
    this.assertProperty('color');
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const radius = this.valueAt(env, 'radius', t);
    this.radiusMark.setExpression(radius);

    const center = this.valueAt(env, 'center', t);
    this.centerMark.setExpression(center);

    const opacity = this.valueAt(env, 'opacity', t).value;
    const isVisible = opacity > 0.000001;
    let color;
    if (isVisible) {
      color = this.valueAt(env, 'color', t);
    }

    if (!center || !radius || (!color && isVisible)) {
      this.hide();
    } else {
      this.show();

      if (this.owns('stroke')) {
        this.untimedProperties.stroke.applyStroke(env, t, this.element);
      }

      this.element.setAttributeNS(null, 'cx', center.get(0).value);
      this.element.setAttributeNS(null, 'cy', bounds.span - center.get(1).value);
      this.element.setAttributeNS(null, 'r', radius.value);
      this.element.setAttributeNS(null, 'fill', isVisible ? color.toColor() : 'none');
      this.element.setAttributeNS(null, 'fill-opacity', opacity);

      this.outlineMark.updateProperties(center, radius, bounds, matrix);
      this.centerMark.updateProperties(center, bounds, matrix);
      this.radiusMark.updateProperties(new ExpressionVector([
        new ExpressionReal(center.get(0).value + radius.value),
        center.get(1)
      ]), bounds, matrix);

      this.updateCentroid(matrix, center, bounds);
      return center;
    }
  }
}

// --------------------------------------------------------------------------- 

export class NodedShape extends Shape {
  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);
    this.nodes = [];
  }

  toPod() {
    const pod = super.toPod();
    pod.nodes = this.nodes.map(node => node.toPod());
    return pod;
  }

  embody(parentEnvironment, pod) {
    super.embody(parentEnvironment, pod);
    this.nodes = pod.nodes.map(subpod => this.root.omniReify(this, subpod));
  }

  validate() {
    super.validate();
    for (let node of this.nodes) {
      node.validate();
    }
  }

  start() {
    super.start();
    for (let node of this.nodes) {
      node.start();
    }
  }

  traverseNodes(env, t, bounds, matrix) {
    let currentTurtle = new Turtle(null, null);
    const pieces = [];
    for (let node of this.nodes) {
      const piece = node.updateProperties(env, t, bounds, currentTurtle, matrix);
      pieces.push(piece);
      currentTurtle = piece.turtle;
    }
    return pieces;
  }

  updateTransforms(env, t, bounds, initialMatrix) {
    const matrix = super.updateTransforms(env, t, bounds, initialMatrix);
    for (let node of this.nodes) {
      node.marker.updateForegroundTransforms(matrix);
    }
  }

  castCursorIntoComponents(column, row) {
    for (let node of this.nodes) {
      if (node.castCursor(column, row)) {
        return true;
      }
    }
    return super.castCursorIntoComponents(column, row);
  }
}

// --------------------------------------------------------------------------- 

export class Polygon extends NodedShape {
  static type = 'polygon';
  static article = 'a';
  static timedIds = ['color', 'opacity'];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.bindFunction('vertex', new FunctionDefinition('vertex', [], new ExpressionVertexNode(this)));
    this.bindFunction('turtle', new FunctionDefinition('turtle', [], new ExpressionTurtleNode(this)));
    this.bindFunction('turn', new FunctionDefinition('turn', [], new ExpressionTurnNode(this)));
    this.bindFunction('move', new FunctionDefinition('move', [], new ExpressionMoveNode(this)));
  }

  static create(parentEnvironment, where) {
    const shape = new Polygon();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Polygon();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();

    this.element = document.createElementNS(svgNamespace, 'polygon');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.outlineMark = new PolygonMark();
    this.markers[0].addMarks([], [this.outlineMark]);
    this.connect();
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const pieces = this.traverseNodes(env, t, bounds, matrix);
    const positions = pieces.map(piece => piece.turtle.position);

    const opacity = this.valueAt(env, 'opacity', t).value;
    const isVisible = opacity > 0.000001;
    let color;
    if (isVisible) {
      color = this.valueAt(env, 'color', t);
    }

    if (positions.some(position => !position) || !color) {
      this.hide();
    } else {
      this.show();

      if (this.owns('stroke')) {
        this.untimedProperties.stroke.applyStroke(env, t, this.element);
      }

      const coordinates = positions.map(p => `${p.get(0).value},${bounds.span - p.get(1).value}`).join(' ');

      // TODO ensure opacity? color?
      this.element.setAttributeNS(null, 'fill-opacity', opacity);
      this.element.setAttributeNS(null, 'points', coordinates);
      this.element.setAttributeNS(null, 'fill', color.toColor());

      this.outlineMark.updateProperties(coordinates, matrix);

      const total = positions.reduce((acc, p) => acc.add(p), new ExpressionVector([new ExpressionReal(0), new ExpressionReal(0)]));
      const centroid = positions.length == 0 ? total : total.divide(new ExpressionReal(positions.length));
      this.updateCentroid(matrix, centroid, bounds);
      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Polyline extends NodedShape {
  static type = 'polyline';
  static article = 'a';
  static timedIds = ['size', 'color', 'opacity', 'dashes'];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.bindFunction('vertex', new FunctionDefinition('vertex', [], new ExpressionVertexNode(this)));
    this.bindFunction('turtle', new FunctionDefinition('turtle', [], new ExpressionTurtleNode(this)));
    this.bindFunction('turn', new FunctionDefinition('turn', [], new ExpressionTurnNode(this)));
    this.bindFunction('move', new FunctionDefinition('move', [], new ExpressionMoveNode(this)));
  }

  static create(parentEnvironment, where) {
    const shape = new Polyline();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Polyline();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  validate() {
    super.validate();
    this.assertProperty('size');
    this.assertProperty('color');
  }

  start() {
    super.start();

    this.element = document.createElementNS(svgNamespace, 'polyline');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);
    this.element.setAttributeNS(null, 'fill', 'none');

    this.outlineMark = new PolylineMark();
    this.markers[0].addMarks([], [this.outlineMark]);
    this.connect();
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const pieces = this.traverseNodes(env, t, bounds, matrix);
    const positions = pieces.map(piece => piece.turtle.position);

    if (positions.some(position => !position)) {
      this.hide();
    } else {
      this.show();
      this.applyStroke(env, t, this.element);
      const coordinates = positions.map(p => `${p.get(0).value},${bounds.span - p.get(1).value}`).join(' ');
      this.element.setAttributeNS(null, 'points', coordinates);
      this.outlineMark.updateProperties(coordinates, matrix);

      const total = positions.reduce((acc, p) => acc.add(p), new ExpressionVector([new ExpressionReal(0), new ExpressionReal(0)]));
      const centroid = positions.length == 0 ? total : total.divide(new ExpressionReal(positions.length));
      this.updateCentroid(matrix, centroid, bounds);
      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Line extends NodedShape {
  static type = 'line';
  static article = 'a';
  static timedIds = ['size', 'color', 'opacity', 'dashes'];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.bindFunction('vertex', new FunctionDefinition('vertex', [], new ExpressionVertexNode(this)));
    this.bindFunction('turtle', new FunctionDefinition('turtle', [], new ExpressionTurtleNode(this)));
    this.bindFunction('turn', new FunctionDefinition('turn', [], new ExpressionTurnNode(this)));
    this.bindFunction('move', new FunctionDefinition('move', [], new ExpressionMoveNode(this)));
  }

  static create(parentEnvironment, where) {
    const shape = new Line();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Line();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  validate() {
    super.validate();
    this.assertProperty('size');
    this.assertProperty('color');
    this.assertProperty('opacity');
  }

  start() {
    super.start();

    this.element = document.createElementNS(svgNamespace, 'line');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.markers[0].addMarks([], []);
    this.connect();
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const pieces = this.traverseNodes(env, t, bounds, matrix);
    const positions = pieces.map(piece => piece.turtle.position);

    if (positions.length != 2) {
      throw new LocatedException(this.where, `I tried to draw a line that had ${positions.length} ${positions.length == 1 ? 'vertex' : 'vertices'}. Lines must have exactly 2 vertices.`);
    }

    if (positions.some(position => !position)) {
      this.hide();
    } else {
      this.show();
      this.applyStroke(env, t, this.element);

      const coordinates = positions.map(p => `${p.get(0).value},${bounds.span - p.get(1).value}`).join(' ');

      this.element.setAttributeNS(null, 'x1', positions[0].get(0).value);
      this.element.setAttributeNS(null, 'y1', bounds.span - positions[0].get(1).value);
      this.element.setAttributeNS(null, 'x2', positions[1].get(0).value);
      this.element.setAttributeNS(null, 'y2', bounds.span - positions[1].get(1).value);

      const total = positions.reduce((acc, p) => acc.add(p), new ExpressionVector([new ExpressionReal(0), new ExpressionReal(0)]));
      const centroid = positions.length == 0 ? total : total.divide(new ExpressionReal(positions.length));
      this.updateCentroid(matrix, centroid, bounds);
      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Ungon extends NodedShape {
  static type = 'ungon';
  static article = 'an';
  static timedIds = ['rounding', 'color', 'opacity'];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.bindFunction('vertex', new FunctionDefinition('vertex', [], new ExpressionVertexNode(this)));
    this.bindFunction('turtle', new FunctionDefinition('turtle', [], new ExpressionTurtleNode(this)));
    this.bindFunction('turn', new FunctionDefinition('turn', [], new ExpressionTurnNode(this)));
    this.bindFunction('move', new FunctionDefinition('move', [], new ExpressionMoveNode(this)));
  }

  static create(parentEnvironment, where) {
    const shape = new Ungon();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Ungon();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  validate() {
    super.validate();
    this.assertProperty('color');
    this.assertProperty('rounding');
  }

  start() {
    super.start();

    this.element = document.createElementNS(svgNamespace, 'path');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.outlineMark = new PolygonMark();
    this.markers[0].addMarks([], [this.outlineMark]);
    this.connect();
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const pieces = this.traverseNodes(env, t, bounds, matrix);
    const positions = pieces.map(piece => piece.turtle.position);

    if (positions[0].distance(positions[positions.length - 1]) < 1e-3) {
      positions.pop();
    }

    let rounding = this.valueAt(env, 'rounding', t).value;

    const opacity = this.valueAt(env, 'opacity', t).value;
    const isVisible = opacity > 0.000001;
    let color;
    if (isVisible) {
      color = this.valueAt(env, 'color', t);
    }

    if (positions.some(position => !position) || !color) {
      this.hide();
    } else {
      this.show();

      if (this.owns('stroke')) {
        this.untimedProperties.stroke.applyStroke(env, t, this.element);
      }

      const coordinates = positions.map(p => `${p.get(0).value},${bounds.span - p.get(1).value}`).join(' ');
      this.outlineMark.updateProperties(coordinates, matrix);

      rounding = 1 - rounding;
      let pathCommands = [];
      let start = positions[0].midpoint(positions[1]);
      pathCommands.push(`M ${start.get(0).value},${bounds.span - start.get(1).value}`);
      let previous = start;
      for (let i = 1; i < positions.length; ++i) {
        let mid = positions[i].midpoint(positions[(i + 1) % positions.length]);

        if (rounding) {
          let control1 = previous.interpolateLinear(positions[i], rounding);
          let control2 = mid.interpolateLinear(positions[i], rounding);
          pathCommands.push(`C ${control1.get(0).value},${bounds.span - control1.get(1).value} ${control2.get(0).value},${bounds.span - control2.get(1).value} ${mid.get(0).value},${bounds.span - mid.get(1).value}`);
        } else {
          pathCommands.push(`Q ${positions[i].get(0).value},${bounds.span - positions[i].get(1).value} ${mid.get(0).value},${bounds.span - mid.get(1).value}`);
        }
        previous = mid;
      }

      if (rounding) {
        let control1 = previous.interpolateLinear(positions[0], rounding);
        let control2 = start.interpolateLinear(positions[0], rounding);
        pathCommands.push(`C ${control1.get(0).value},${bounds.span - control1.get(1).value} ${control2.get(0).value},${bounds.span - control2.get(1).value} ${start.get(0).value},${bounds.span - start.get(1).value}`);
      } else {
        pathCommands.push(`Q${positions[0].get(0).value},${bounds.span - positions[0].get(1).value} ${start.get(0).value},${bounds.span - start.get(1).value}`);
      }
      // pathCommands.push('z');

      this.element.setAttributeNS(null, 'd', pathCommands.join(' '));

      this.element.setAttributeNS(null, 'fill-opacity', opacity);
      this.element.setAttributeNS(null, 'points', coordinates);
      this.element.setAttributeNS(null, 'fill', color.toColor());

      const total = positions.reduce((acc, p) => acc.add(p), new ExpressionVector([new ExpressionReal(0), new ExpressionReal(0)]));
      const centroid = positions.length == 0 ? total : total.divide(new ExpressionReal(positions.length));
      this.updateCentroid(matrix, centroid, bounds);
      return centroid;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Path extends NodedShape {
  static type = 'path';
  static article = 'a';
  static timedIds = ['color', 'opacity'];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);

    this.untimedProperties.mirror = Mirror.create(this);
    this.bindFunction('turtle', new FunctionDefinition('turtle', [], new ExpressionTurtleNode(this)));
    this.bindFunction('turn', new FunctionDefinition('turn', [], new ExpressionTurnNode(this)));
    this.bindFunction('move', new FunctionDefinition('move', [], new ExpressionMoveNode(this)));
    this.bindFunction('jump', new FunctionDefinition('jump', [], new ExpressionJumpNode(this)));
    this.bindFunction('line', new FunctionDefinition('line', [], new ExpressionLineNode(this)));
    this.bindFunction('quadratic', new FunctionDefinition('line', [], new ExpressionQuadraticNode(this)));
    this.bindFunction('cubic', new FunctionDefinition('line', [], new ExpressionCubicNode(this)));
    this.bindFunction('arc', new FunctionDefinition('arc', [], new ExpressionArcNode(this)));
  }

  static create(parentEnvironment, where) {
    const shape = new Path();
    shape.initialize(parentEnvironment, where);
    shape.untimedProperties.closed = new ExpressionBoolean(false);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Path();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();

    this.element = document.createElementNS(svgNamespace, 'path');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.outlineMark = new PathMark();

    this.markers[0].addMarks([], [this.outlineMark]);
    this.connect();
  }

  validate() {
    super.validate();
    this.assertProperty('closed');
    this.assertProperty('color');
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);

    const pieces = this.traverseNodes(env, t, bounds, matrix);

    const opacity = this.valueAt(env, 'opacity', t).value;
    const isVisible = opacity > 0.000001;
    let color;
    if (isVisible) {
      color = this.valueAt(env, 'color', t);
    }

    let isClosed = this.untimedProperties.closed.value;

    if (pieces.some(piece => !piece)) {
      this.hide();
    } else {
      this.show();

      if (this.owns('stroke')) {
        this.untimedProperties.stroke.applyStroke(env, t, this.element);
      }

      const pathCommands = pieces.map(piece => piece.pathCommand);
      let commandString = pathCommands.join(' ');
      if (isClosed) {
        commandString += ' Z';
      }

      this.element.setAttributeNS(null, 'd', commandString);
      this.element.setAttributeNS(null, 'fill', color ? color.toColor() : 'none');
      this.element.setAttributeNS(null, 'fill-opacity', opacity);

      this.outlineMark.updateProperties(commandString, matrix);

      return null;
    }
  }
}

// --------------------------------------------------------------------------- 

export class Group extends Shape {
  static type = 'group';
  static article = 'a';
  static timedIds = [];

  initialize(parentEnvironment, where) {
    super.initialize(parentEnvironment, where);
    this.children = [];
  }

  toPod() {
    const pod = super.toPod();
    pod.children = this.children.map(child => child.toPod());
    return pod;
  }

  embody(parentEnvironment, pod) {
    super.embody(parentEnvironment, pod);
    this.children = pod.children.map(subpod => Shape.reify(this, subpod));
  }

  static create(parentEnvironment, where) {
    const shape = new Group();
    shape.initialize(parentEnvironment, where);
    return shape;
  }

  static reify(parentEnvironment, pod) {
    const shape = new Group();
    shape.embody(parentEnvironment, pod);
    return shape;
  }

  start() {
    super.start();
    this.element = document.createElementNS(svgNamespace, 'g');
    this.element.setAttributeNS(null, 'id', 'element-' + this.id);

    this.markers[0].addMarks([], []);
    this.connect();
  }

  updateProperties(env, t, bounds, matrix) {
    matrix = this.transform(env, t, bounds, matrix);
    const childCentroids = this.children.map(child => child.updateProperties(env, t, bounds, matrix));
    const total = childCentroids.reduce((acc, centroid) => acc.add(centroid), new ExpressionVector([new ExpressionReal(0), new ExpressionReal(0)]));
    const centroid = this.children.length == 0 ? total : total.divide(new ExpressionReal(this.children.length));
    this.updateCentroid(matrix, centroid, bounds);
    return centroid;
  }

  updateTransforms(env, t, bounds, initialMatrix) {
    const matrix = super.updateTransforms(env, t, bounds, initialMatrix);
    for (let child of this.children) {
      child.updateTransforms(env, t, bounds, matrix);
    }
  }
}
