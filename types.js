import { Timeline } from './timeline.js';

import { 
  ExpressionBoolean,
  ExpressionCircle,
  ExpressionCosine,
  ExpressionCutout,
  ExpressionGroup,
  ExpressionInt,
  ExpressionInteger,
  ExpressionLabel,
  ExpressionLine,
  ExpressionMask,
  ExpressionPath,
  ExpressionPathArc,
  ExpressionPathJump,
  ExpressionPathLine,
  ExpressionPolygon,
  ExpressionPolyline,
  ExpressionPrint,
  ExpressionRandom,
  ExpressionReal,
  ExpressionRectangle,
  ExpressionSine,
  ExpressionString,
  ExpressionVector,
  ExpressionVertex,
} from './ast.js';

export let svgNamespace = "http://www.w3.org/2000/svg";

// --------------------------------------------------------------------------- 

export class MessagedException extends Error {
  constructor(message) {
    super(message);
  }

  get userMessage() {
    return this.message;
  }
}

// --------------------------------------------------------------------------- 

export class LocatedException extends MessagedException {
  constructor(where, message) {
    super(message);
    this.where = where;
  }

  get userMessage() {
    return `${this.where.debugPrefix()}${this.message}`;
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleEnvironment {
  constructor(parent) {
    this.bindings = {};
    this.parent = parent;
    if (parent) {
      this.shapes = parent.shapes;
      this.svg = parent.svg;
    }
  }

  get(id) {
    let env = this;
    while (env != null) {
      if (env.bindings.hasOwnProperty(id)) {
        return env.bindings[id];
      }
      env = env.parent;
    }
    return null;
  }

  owns(id) {
    return this.bindings.hasOwnProperty(id);
  }

  has(id) {
    let env = this;
    while (env != null) {
      if (env.bindings.hasOwnProperty(id)) {
        return true;
      }
      env = env.parent;
    }
    return false;
  }

  bind(id, fromTime, toTime, value) {
    this.bindings[id] = value;
  }

  valueAt(env, property, t) {
    // Assumes property exists.
    return this.bindings[property].valueAt(env, t);
  }

  evaluate(env, fromTime, toTime) {
    return this;
  }
}

// ---------------------------------------------------------------------------

export class TwovilleTimelinedEnvironment extends TwovilleEnvironment {
  constructor(env) {
    super(env);
  }

  bind(id, fromTime, toTime, value) {
    if (!this.bindings.hasOwnProperty(id)) {
      this.bindings[id] = new Timeline();
    }

    if (fromTime != null && toTime != null) {
      this.bindings[id].setFromValue(fromTime, value);
      this.bindings[id].setToValue(toTime, value);
    } else if (fromTime != null) {
      this.bindings[id].setFromValue(fromTime, value);
    } else if (toTime != null) {
      this.bindings[id].setToValue(toTime, value);
    } else {
      this.bindings[id].setDefault(value);
    }
  }

}

// --------------------------------------------------------------------------- 

export let serial = 0;

export function initializeShapes() {
  serial = 0;
}

export class TwovilleShape extends TwovilleTimelinedEnvironment {
  constructor(env, callExpression, type) {
    super(env, callExpression);
    this.type = type;
    this.callExpression = callExpression;
    this.parentElement = null;
    this.bindings.stroke = new TwovilleTimelinedEnvironment(this);
    this.bind('opacity', null, null, new ExpressionReal(null, 1));
    this.id = serial;
    ++serial;
  }

  getRGB(env, t) {
    let isCutout = this.owns('parent') && this.get('parent').defaultValue instanceof TwovilleCutout;

    if (!this.has('rgb') && !isCutout) {
      throw new LocatedException(this.callExpression.where, `I found a ${this.type} whose rgb property is not defined.`);
    }
    
    let rgb;
    if (isCutout) {
      rgb = new ExpressionVector(null, [
        new ExpressionInteger(null, 0),
        new ExpressionInteger(null, 0),
        new ExpressionInteger(null, 0),
      ]);
    } else {
      rgb = this.valueAt(env, 'rgb', t);
    }

    return rgb;
  }

  domify(svg) {
    if (this.has('clippers')) {
      let clipPath = document.createElementNS(svgNamespace, 'clipPath');
      clipPath.setAttributeNS(null, 'id', 'clip-' + this.id);
      let clippers = this.get('clippers').getDefault();
      clippers.forEach(clipper => {
        let use = document.createElementNS(svgNamespace, 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#element-' + clipper.id);
        clipPath.appendChild(use);
      });
      svg.firstChild.appendChild(clipPath);
      this.svgElement.setAttributeNS(null, 'clip-path', 'url(#clip-' + this.id + ')');
    }

    if (this.owns('mask')) {
      let mask = this.get('mask').getDefault();
      this.svgElement.setAttributeNS(null, 'mask', 'url(#element-' + mask.id + ')');
    }

    if (this.owns('parent')) {
      this.parentElement = this.get('parent').getDefault().svgElement;
    } else if (this.owns('template') && this.get('template').getDefault().value) {
      this.parentElement = svg.firstChild;
    } else {
      this.parentElement = this.svg;
    }
    this.parentElement.appendChild(this.svgElement);
  }

  isTimeSensitive(env) {
    return false;
  }

  assertProperty(id) {
    if (!this.has(id)) {
      throw new LocatedException(this.callExpression.where, `I found a ${this.type} whose ${id} property is not defined.`);
    }
  }

  show() {
    this.svgElement.setAttributeNS(null, 'visibility', 'visible');
  }

  hide() {
    this.svgElement.setAttributeNS(null, 'visibility', 'hidden');
  }
 
  setStroke(env, t) {
    if (this.has('stroke')) {
      let stroke = this.get('stroke');
      if (stroke.owns('size') &&
          stroke.owns('rgb') &&
          stroke.owns('opacity')) {
        let strokeSize = stroke.valueAt(env, 'size', t);
        let strokeRGB = stroke.valueAt(env, 'rgb', t);
        let strokeOpacity = stroke.valueAt(env, 'opacity', t);
        this.svgElement.setAttributeNS(null, 'stroke', strokeRGB.toRGB());
        this.svgElement.setAttributeNS(null, 'stroke-width', strokeSize.value);
        this.svgElement.setAttributeNS(null, 'stroke-opacity', strokeOpacity.value);
      }
    }
  }

  setTransform(env, t) {
    if (this.has('rotation')) {
      if (this.has('pivot')) {
        let pivot = this.valueAt(env, 'pivot', t);
        let rotation = this.valueAt(env, 'rotation', t);
        if (pivot && rotation) {
          this.svgElement.setAttributeNS(null, 'transform', 'rotate(' + rotation.value + ' ' + pivot.get(0).value + ',' + pivot.get(1).value + ')');
        }
      } else {
        throw new LocatedException(this.callExpression.where, `I found a ${this.type} that is rotated, but it\'s pivot property is not defined.`);
      }
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleGroup extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'group');
    this.children = [];
    this.svgElement = document.createElementNS(svgNamespace, 'group');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
  }

  draw(env, t) {
    this.children.forEach(child => child.draw(env, t));
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleMask extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'mask');
    this.children = [];
    this.svgElement = document.createElementNS(svgNamespace, 'mask');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.bind('template', null, null, new ExpressionBoolean(null, true));
  }

  draw(env, t) {
    this.children.forEach(child => child.draw(env, t));
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleCutout extends TwovilleMask {
  constructor(env, callExpression) {
    super(env, callExpression);

    let size = env.get('viewport').get('size');

    let corner;
    if (env.get('viewport').has('corner')) {
      corner = env.get('viewport').get('corner');
    } else if (env.get('viewport').has('center')) {
      let center = env.get('viewport').get('center');
      corner = new ExpressionVector(null, [
        new ExpressionReal(null, center.get(0).value - size.get(0).value * 0.5),
        new ExpressionReal(null, center.get(1).value - size.get(1).value * 0.5),
      ]);
    } else {
      corner = new ExpressionVector(null, [
        new ExpressionInteger(null, 0),
        new ExpressionInteger(null, 0),
      ]);
    }

    let rectangle = document.createElementNS(svgNamespace, 'rect');
    rectangle.setAttributeNS(null, 'x', corner.get(0).value);
    rectangle.setAttributeNS(null, 'y', corner.get(1).value);
    rectangle.setAttributeNS(null, 'width', '100%');
    rectangle.setAttributeNS(null, 'height', '100%');
    rectangle.setAttributeNS(null, 'fill', 'white');

    this.svgElement.appendChild(rectangle);
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleLabel extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'label');
    this.svgElement = document.createElementNS(svgNamespace, 'text');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.svgElement.appendChild(document.createTextNode('foo'));
  }

  draw(env, t) {
    this.assertProperty('position');
    this.assertProperty('text');
    
    let position = this.valueAt(env, 'position', t);
    let rgb = this.getRGB(env, t);
    let text = this.valueAt(env, 'text', t);

    let fontSize;
    if (this.has('size')) {
      fontSize = this.valueAt(env, 'size', t);
    } else {
      fontSize = new ExpressionInteger(null, 8);
    }

    let anchor;
    if (this.has('anchor')) {
      anchor = this.valueAt(env, 'anchor', t);
    } else {
      anchor = new ExpressionString(null, 'middle');
    }

    let baseline;
    if (this.has('baseline')) {
      baseline = this.valueAt(env, 'baseline', t);
    } else {
      baseline = new ExpressionString(null, 'middle');
    }

    if (position == null || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);
      this.svgElement.childNodes[0].nodeValue = text.value;
      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'x', position.get(0).value);
      this.svgElement.setAttributeNS(null, 'y', position.get(1).value);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
      this.svgElement.setAttributeNS(null, 'font-size', fontSize.value);
      this.svgElement.setAttributeNS(null, 'text-anchor', anchor.value);
      this.svgElement.setAttributeNS(null, 'alignment-baseline', baseline.value);
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleVertex extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'vertex');
    env.nodes.push(this);
  }

  evaluate(env, t) {
    this.assertProperty('position');
    return this.valueAt(env, 'position', t);
  }

  evolve(env, t) {
    this.assertProperty('position');
    let position = this.valueAt(env, 'position', t);
    
    if (position) {
      return `${position.get(0).value},${position.get(1).value}`;
    } else {
      return null;
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePathJump extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'jump');
    env.nodes.push(this);
  }

  evolve(env, t) {
    this.assertProperty('position');
    
    let position = this.valueAt(env, 'position', t);

    if (position) {
      return `M${position.get(0).value},${position.get(1).value}`;
    } else {
      return null;
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePathLine extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'line');
    env.nodes.push(this);
  }

  evolve(env, t) {
    this.assertProperty('position');
    
    let position = this.valueAt(env, 'position', t);

    if (position) {
      return `L${position.get(0).value},${position.get(1).value}`;
    } else {
      return null;
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePathArc extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'arc');
    env.nodes.push(this);
  }

  evolve(env, t, from) {
    this.assertProperty('position');
    this.assertProperty('direction');
    this.assertProperty('center');
    
    let position = this.valueAt(env, 'position', t);
    let direction = this.valueAt(env, 'direction', t);
    let center = this.valueAt(env, 'center', t);

    if (position) {
      let diff2 = position.subtract(center);
      let diff1 = from.subtract(center);
      let radius = diff1.magnitude;
      let area = 0.5 * (diff1.get(0).value * diff2.get(1).value - diff2.get(0).value * diff1.get(1).value);

      let large;
      let sweep;

      if (direction.value == 0) {
        if (area < 0) {
          large = 1;
          sweep = 1;
        } else {
          large = 0;
          sweep = 1;
        }
      } else {
        if (area > 0) {
          large = 1;
          sweep = 0;
        } else {
          large = 0;
          sweep = 0;
        }
      }

      return `A${radius},${radius} 0 ${large} ${sweep} ${position.get(0).value},${position.get(1).value}`;
    } else {
      return null;
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleLine extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'line');
    this.svgElement = document.createElementNS(svgNamespace, 'line');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.nodes = [];

    this.bindings['vertex'] = {
      name: 'vertex',
      formals: [],
      body: new ExpressionVertex()
    };
  }

  draw(env, t) {
    if (this.nodes.length != 2) {
      throw new LocatedException(this.callExpression.where, `I tried to draw a line that had ${this.nodes.length} ${this.nodes.size == 1 ? 'vertex' : 'vertices'}. Lines must only have two vertices.`);
    }
    
    let vertices = this.nodes.map(vertex => vertex.evaluate(env, t));
    let rgb = this.getRGB(env, t);

    if (vertices.some(v => v == null) || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);

      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'x1', vertices[0].get(0).value);
      this.svgElement.setAttributeNS(null, 'y1', vertices[0].get(1).value);
      this.svgElement.setAttributeNS(null, 'x2', vertices[1].get(0).value);
      this.svgElement.setAttributeNS(null, 'y2', vertices[1].get(1).value);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePath extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'path');
    this.svgElement = document.createElementNS(svgNamespace, 'path');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.nodes = [];

    this.bindings['arc'] = {
      name: 'arc',
      formals: [],
      body: new ExpressionPathArc()
    };

    this.bindings['jump'] = {
      name: 'jump',
      formals: [],
      body: new ExpressionPathJump()
    };

    this.bindings['line'] = {
      name: 'line',
      formals: [],
      body: new ExpressionPathLine()
    };
  }

  draw(env, t) {
    let isClosed = true;
    if (this.has('closed')) {
      isClosed = this.valueAt(env, 'closed', t).value;
    }

    let rgb = this.getRGB(env, t);
    let vertices = this.nodes.map((vertex, i) => {
      let from = i == 0 ? null : this.nodes[i - 1].valueAt(env, 'position', t);
      return vertex.evolve(env, t, from);
    });

    if (vertices.some(v => v == null) || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);
      
      let commands = vertices.join(' ');
      if (isClosed) {
        commands += ' Z';
      }

      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'd', commands);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePolygon extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'polygon');
    this.svgElement = document.createElementNS(svgNamespace, 'polygon');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.nodes = [];

    this.bindings['vertex'] = {
      name: 'vertex',
      formals: [],
      body: new ExpressionVertex()
    };
  }

  draw(env, t) {
    let rgb = this.getRGB(env, t);
    let vertices = this.nodes.map(vertex => vertex.evolve(env, t));

    if (vertices.some(v => v == null) || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);

      let commands = vertices.join(' ');

      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'points', commands);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovillePolyline extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'polyline');
    this.svgElement = document.createElementNS(svgNamespace, 'polyline');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
    this.nodes = [];

    this.bindings['vertex'] = {
      name: 'vertex',
      formals: [],
      body: new ExpressionVertex()
    };
  }

  draw(env, t) {
    this.assertProperty('size');

    let size = this.valueAt(env, 'size', t);
    let rgb = this.getRGB(env, t);
    let vertices = this.nodes.map(vertex => vertex.evolve(env, t));

    if (vertices.some(v => v == null) || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);

      let commands = vertices.join(' ');

      this.svgElement.setAttributeNS(null, 'stroke-width', size.value);
      this.svgElement.setAttributeNS(null, 'stroke-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'points', commands);
      this.svgElement.setAttributeNS(null, 'stroke', rgb.toRGB());
      this.svgElement.setAttributeNS(null, 'fill', 'none');
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleRectangle extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'rectangle');
    this.svgElement = document.createElementNS(svgNamespace, 'rect');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
  }

  draw(env, t) {
    if (this.has('corner') && this.has('center')) {
      throw new LocatedException(this.callExpression.where, 'I found a rectangle whose corner and center properties were both set. Define only one of these.');
    }

    if (!this.has('corner') && !this.has('center')) {
      throw new LocatedException(this.callExpression.where, 'I found a rectangle whose location I couldn\'t figure out. Please define its corner or center.');
    }
    
    this.assertProperty('size');

    let size = this.valueAt(env, 'size', t);

    let corner;
    if (this.has('corner')) {
      corner = this.valueAt(env, 'corner', t);
    } else {
      let center = this.valueAt(env, 'center', t);
      corner = new ExpressionVector(null, [
        new ExpressionReal(null, center.get(0).value - size.get(0).value * 0.5),
        new ExpressionReal(null, center.get(1).value - size.get(1).value * 0.5),
      ]);
    }

    let rgb = this.getRGB(env, t);

    if (corner == null || size == null || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setStroke(env, t);
      this.setTransform(env, t);

      if (this.has('rounding')) {
        let rounding = this.valueAt(env, 'rounding', t);
        this.svgElement.setAttributeNS(null, 'rx', rounding.value);
        this.svgElement.setAttributeNS(null, 'ry', rounding.value);
      }

      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);

      this.svgElement.setAttributeNS(null, 'x', corner.get(0).value);
      this.svgElement.setAttributeNS(null, 'y', corner.get(1).value);
      this.svgElement.setAttributeNS(null, 'width', size.get(0).value);
      this.svgElement.setAttributeNS(null, 'height', size.get(1).value);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
}

// --------------------------------------------------------------------------- 

export class TwovilleCircle extends TwovilleShape {
  constructor(env, callExpression) {
    super(env, callExpression, 'circle');
    this.svgElement = document.createElementNS(svgNamespace, 'circle');
    this.svgElement.setAttributeNS(null, 'id', 'element-' + this.id);
  }

  draw(env, t) {
    this.assertProperty('center');
    this.assertProperty('radius');
    
    let center = this.valueAt(env, 'center', t);
    let radius = this.valueAt(env, 'radius', t);
    let rgb = this.getRGB(env, t);

    if (center == null || radius == null || rgb == null) {
      this.hide();
    } else {
      this.show();
      this.setTransform(env, t);
      this.setStroke(env, t);
      this.svgElement.setAttributeNS(null, 'fill-opacity', this.valueAt(env, 'opacity', t).value);
      this.svgElement.setAttributeNS(null, 'cx', center.get(0).value);
      this.svgElement.setAttributeNS(null, 'cy', center.get(1).value);
      this.svgElement.setAttributeNS(null, 'r', radius.value);
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
}

// --------------------------------------------------------------------------- 

export class GlobalEnvironment extends TwovilleEnvironment {
  constructor(svg) {
    super(null);
    this.svg = svg;
    this.shapes = [];

    this.bindings.time = new TwovilleEnvironment(this);
    this.bindings.time.bind('start', null, null, new ExpressionInteger(null, 0));
    this.bindings.time.bind('stop', null, null, new ExpressionInteger(null, 100));

    this.bindings.viewport = new TwovilleEnvironment(this);
    this.bindings.viewport.bind('size', null, null, new ExpressionVector(null, [
      new ExpressionInteger(null, 100),
      new ExpressionInteger(null, 100)
    ]));

    this.bindings['rectangle'] = {
      name: 'rectangle',
      formals: [],
      body: new ExpressionRectangle()
    };

    this.bindings['line'] = {
      name: 'line',
      formals: [],
      body: new ExpressionLine()
    };

    this.bindings['path'] = {
      name: 'path',
      formals: [],
      body: new ExpressionPath()
    };

    this.bindings['polygon'] = {
      name: 'polygon',
      formals: [],
      body: new ExpressionPolygon()
    };

    this.bindings['polyline'] = {
      name: 'polyline',
      formals: [],
      body: new ExpressionPolyline()
    };

    this.bindings['label'] = {
      name: 'label',
      formals: [],
      body: new ExpressionLabel()
    };

    this.bindings['group'] = {
      name: 'group',
      formals: [],
      body: new ExpressionGroup()
    };

    this.bindings['mask'] = {
      name: 'mask',
      formals: [],
      body: new ExpressionMask()
    };

    this.bindings['cutout'] = {
      name: 'cutout',
      formals: [],
      body: new ExpressionCutout()
    };

    this.bindings['circle'] = {
      name: 'circle',
      formals: [],
      body: new ExpressionCircle()
    };

    this.bindings['print'] = {
      name: 'print',
      formals: ['message'],
      body: new ExpressionPrint()
    };

    this.bindings['random'] = {
      name: 'random',
      formals: ['min', 'max'],
      body: new ExpressionRandom()
    };

    this.bindings['sin'] = {
      name: 'sin',
      formals: ['degrees'],
      body: new ExpressionSine()
    };

    this.bindings['cos'] = {
      name: 'cos',
      formals: ['degrees'],
      body: new ExpressionCosine()
    };

    this.bindings['int'] = {
      name: 'int',
      formals: ['x'],
      body: new ExpressionInt()
    };
  }
}

// --------------------------------------------------------------------------- 

