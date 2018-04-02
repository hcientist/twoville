// --------------------------------------------------------------------------- 

var TwovilleEnvironment = {
  create: function(parent) {
    var instance = Object.create(TwovilleEnvironment);
    return Object.assign(instance, {
      bindings: {},
      shapes: parent.shapes,
      svg: parent.svg,
      parent: parent
    });
  },
  get: function(id) {
    var env = this;
    while (env != null) {
      if (env.bindings.hasOwnProperty(id)) {
        return env.bindings[id];
      }
      env = env.parent;
    }
    throw 'no such var --' + id + '--';
  },
  owns: function(id) {
    return this.bindings.hasOwnProperty(id);
  },
  has: function(id) {
    var env = this;
    while (env != null) {
      if (env.bindings.hasOwnProperty(id)) {
        return true;
      }
      env = env.parent;
    }
    return false;
  },
  bindUntimelined: function(id, value) {
    this.bindings[id] = value;
  },
  bindTimelined: function(id, fromTime, toTime, value) {
    if (!this.bindings.hasOwnProperty(id)) {
      this.bindings[id] = Timeline.create();
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
  },
  valueAt: function(property, t) {
    console.log("this:", this);
    // Assumes property exists.
    console.log("property:", property);
    return this.bindings[property].valueAt(t);
  },
}

// --------------------------------------------------------------------------- 

var TwovilleShape = Object.create(TwovilleEnvironment);
Object.assign(TwovilleShape, {
  bind: function(env, fromTime, toTime, id) {
    env.bindUntimelined(id, this);
  },
  create: function(env) {
    var instance = TwovilleEnvironment.create(env);
    Object.setPrototypeOf(instance, TwovilleShape);
    instance.bindings.stroke = TwovilleEnvironment.create(instance);
    instance.bindTimelined('opacity', null, null, TwovilleReal.create(1));
    return instance;
  }
});

// --------------------------------------------------------------------------- 

var TwovilleRectangle = Object.create(TwovilleShape);
Object.assign(TwovilleRectangle, {
  create: function(env) {
    var instance = TwovilleShape.create(env);
    Object.setPrototypeOf(instance, TwovilleRectangle);
    instance = Object.assign(instance, {
      svgElement: document.createElementNS(namespace, 'rect')
    });
    instance.svg.appendChild(instance.svgElement);
    return instance;
  },
  draw: function(svg, t) {
    if (!this.has('position')) {
      throw 'no position';
    }
    
    if (!this.has('size')) {
      throw 'no size';
    }
    
    if (!this.has('rgb')) {
      throw 'no rgb';
    }
    
    var needsTransforming = false;

    if (this.has('rotation')) {
      if (this.has('pivot')) {
        needsTransforming = true;
      } else {
        throw 'rotation but not pivot';
      }
    }

    // If we have rotation, but no pivot, error.

    var position = this.valueAt('position', t);
    var size = this.valueAt('size', t);
    var rgb = this.valueAt('rgb', t);

    if (needsTransforming) {
      var pivot = this.valueAt('pivot', t);
      var rotation = this.valueAt('rotation', t);
    }

    if (position == null || size == null || rgb == null || (needsTransforming && (pivot == null || rotation == null))) {
      this.svgElement.setAttributeNS(null, 'opacity', 0);
    } else {
      if (needsTransforming) {
        this.svgElement.setAttributeNS(null, 'transform', 'rotate(' + rotation.get() + ' ' + pivot.get(0).get() + ',' + pivot.get(1).get() + ')');
      }

      if (this.has('stroke')) {
        var stroke = this.get('stroke');
        if (stroke.owns('size') &&
            stroke.owns('rgb') &&
            stroke.owns('opacity')) {
          var strokeSize = stroke.valueAt('size', t);
          var strokeRGB = stroke.valueAt('rgb', t);
          var strokeOpacity = stroke.valueAt('opacity', t);
          this.svgElement.setAttributeNS(null, 'stroke', strokeRGB.toRGB());
          this.svgElement.setAttributeNS(null, 'stroke-width', strokeSize.get());
          this.svgElement.setAttributeNS(null, 'stroke-opacity', strokeOpacity.get());
        }
      }

      this.svgElement.setAttributeNS(null, 'opacity', this.valueAt('opacity', t).get());
      this.svgElement.setAttributeNS(null, 'x', position.get(0).get());
      this.svgElement.setAttributeNS(null, 'y', position.get(1).get());
      this.svgElement.setAttributeNS(null, 'width', size.get(0).get());
      this.svgElement.setAttributeNS(null, 'height', size.get(1).get());
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
});

// --------------------------------------------------------------------------- 

var TwovilleCircle = Object.create(TwovilleShape);
Object.assign(TwovilleCircle, {
  create: function(env) {
    var instance = TwovilleShape.create(env);
    Object.setPrototypeOf(instance, TwovilleCircle);
    instance = Object.assign(instance, {
      svgElement: document.createElementNS(namespace, 'circle')
    });
    instance.svg.appendChild(instance.svgElement);
    return instance;
  },
  draw: function(svg, t) {
    if (!this.has('position')) {
      throw 'no position';
    }
    
    if (!this.has('radius')) {
      throw 'no radius';
    }
    
    if (!this.has('rgb')) {
      throw 'no rgb';
    }
    
    var needsTransforming = false;

    if (this.has('rotation')) {
      if (this.has('pivot')) {
        needsTransforming = true;
      } else {
        throw 'rotation but not pivot';
      }
    }

    // If we have rotation, but no pivot, error.

    var position = this.valueAt('position', t);
    var radius = this.valueAt('radius', t);
    var rgb = this.valueAt('rgb', t);

    if (needsTransforming) {
      var pivot = this.valueAt('pivot', t);
      var rotation = this.valueAt('rotation', t);
    }

    if (position == null || radius == null || rgb == null || (needsTransforming && (pivot == null || rotation == null))) {
      this.svgElement.setAttributeNS(null, 'opacity', 0);
    } else {
      if (needsTransforming) {
        this.svgElement.setAttributeNS(null, 'transform', 'rotate(' + rotation.get() + ' ' + pivot.get(0).get() + ',' + pivot.get(1).get() + ')');
      }

      if (this.has('stroke') && this.bi) {
        var stroke = this.get('stroke');
        var strokeSize = stroke.valueAt('size', t);
        var strokeRGB = stroke.valueAt('rgb', t);
        var strokeOpacity = stroke.valueAt('opacity', t);
        this.svgElement.setAttributeNS(null, 'stroke', strokeRGB.toRGB());
        this.svgElement.setAttributeNS(null, 'stroke-width', strokeSize.get());
        this.svgElement.setAttributeNS(null, 'stroke-opacity', strokeOpacity.get());
      }

      this.svgElement.setAttributeNS(null, 'opacity', this.valueAt('opacity', t).get());
      this.svgElement.setAttributeNS(null, 'cx', position.get(0).get());
      this.svgElement.setAttributeNS(null, 'cy', position.get(1).get());
      this.svgElement.setAttributeNS(null, 'r', radius.get());
      this.svgElement.setAttributeNS(null, 'fill', rgb.toRGB());
    }
  }
});

// --------------------------------------------------------------------------- 

var TwovilleData = {
  create: function() {
    return {};
  },
  bind: function(env, fromTime, toTime, id) {
    if (Object.getPrototypeOf(env) === TwovilleEnvironment) {
      env.bindUntimelined(id, this);
    } else {
      env.bindTimelined(id, fromTime, toTime, this);
    }
  },
  evaluate: function(env, fromTime, toTime) {
    return this;
  }
}

// --------------------------------------------------------------------------- 

var TwovilleVector = Object.create(TwovilleData);
Object.assign(TwovilleVector, {
  create: function(elements) {
    var instance = TwovilleData.create();
    Object.setPrototypeOf(instance, TwovilleVector);
    instance = Object.assign(instance, {
      elements: elements
    });
    return instance;
  },
  get: function(i) {
    return this.elements[i];
  },
  evaluate: function(env) {
    return this;
    // return TwovilleVector.create(this.elements.map(element => element.evaluate(env)));
  },
  toRGB: function(env) {
    var r = Math.floor(this.elements[0].get() * 255);
    var g = Math.floor(this.elements[1].get() * 255);
    var b = Math.floor(this.elements[2].get() * 255);
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
  },
  toString: function(env) {
    return '[' + this.elements.map(element => element.toString()).join(', ') + ']';
  },
  interpolate: function(other, proportion) {
    return TwovilleVector.create(this.elements.map((element, i) => element.interpolate(other.get(i), proportion)));
  },
});

// --------------------------------------------------------------------------- 

var TwovilleInteger = Object.create(TwovilleData);
Object.assign(TwovilleInteger, {
  create: function(x) {
    var instance = TwovilleData.create();
    Object.setPrototypeOf(instance, TwovilleInteger);
    instance = Object.assign(instance, {
      x: x
    });
    return instance;
  },
  toString: function() {
    return '' + this.x;
  },
  get: function() {
    return this.x;
  },
  add: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger) {
      return TwovilleInteger.create(this.get() + other.get());
    } else if (Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() + other.get());
    } else {
      throw '...';
    }
  },
  subtract: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger) {
      return TwovilleInteger.create(this.get() - other.get());
    } else if (Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() - other.get());
    } else {
      throw '...';
    }
  },
  multiply: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger) {
      return TwovilleInteger.create(this.get() * other.get());
    } else if (other === TwovilleReal) {
      return TwovilleReal.create(this.get() * other.get());
    } else {
      throw '...';
    }
  },
  divide: function(other) {
    if (other === TwovilleInteger) {
      return TwovilleInteger.create(Math.trunc(this.get() / other.get()));
    } else if (other === TwovilleReal) {
      return TwovilleReal.create(this.get() / other.get());
    } else {
      throw '...';
    }
  },
  remainder: function(other) {
    if (other === TwovilleInteger) {
      return TwovilleInteger.create(this.get() % other.get());
    } else if (other === TwovilleReal) {
      return TwovilleReal.create(this.get() % other.get());
    } else {
      throw '...';
    }
  },
  interpolate: function(other, proportion) {
    return TwovilleReal.create(this.get() + proportion * (other.get() - this.get()));
  }
});

// --------------------------------------------------------------------------- 

var TwovilleReal = Object.create(TwovilleData);
Object.assign(TwovilleReal, {
  create: function(x) {
    var instance = TwovilleData.create();
    Object.setPrototypeOf(instance, TwovilleReal);
    instance = Object.assign(instance, {
      x: x
    });
    return instance;
  },
  toString: function() {
    return '' + this.x;
  },
  get: function() {
    return this.x;
  },
  add: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger ||
        Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() + other.get());
    } else {
      throw '...';
    }
  },
  subtract: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger ||
        Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() - other.get());
    } else {
      throw '...';
    }
  },
  multiply: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger ||
        Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() * other.get());
    } else {
      throw '...';
    }
  },
  divide: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger ||
        Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() / other.get());
    } else {
      throw '...';
    }
  },
  remainder: function(other) {
    if (Object.getPrototypeOf(other) === TwovilleInteger ||
        Object.getPrototypeOf(other) === TwovilleReal) {
      return TwovilleReal.create(this.get() % other.get());
    } else {
      throw '...';
    }
  },
  interpolate: function(other, proportion) {
    return TwovilleReal.create(this.get() + proportion * (other.get() - this.get()));
  }
});

// --------------------------------------------------------------------------- 

var ExpressionRectangle = {
  create: function(parent) {
    return Object.create(ExpressionRectangle);
  },
  evaluate: function(env, fromTime, toTime) {
    var r = TwovilleRectangle.create(env);
    env.shapes.push(r);
    return r;
  }
};

// --------------------------------------------------------------------------- 

var ExpressionCircle = {
  create: function(parent) {
    return Object.create(ExpressionCircle);
  },
  evaluate: function(env, fromTime, toTime) {
    var c = TwovilleCircle.create(env);
    env.shapes.push(c);
    return c;
  }
};

// --------------------------------------------------------------------------- 

var ExpressionPrint = {
  create: function(parent) {
    return Object.create(ExpressionPrint);
  },
  evaluate: function(env, fromTime, toTime) {
    var message = env['message'].get();
    console.log("message:", message);
    log(message.toString(fromTime, toTime));
    return null;
  }
}

// --------------------------------------------------------------------------- 

var ExpressionRandom = {
  create: function(parent) {
    return Object.create(ExpressionRandom);
  },
  evaluate: function(env, fromTime, toTime) {
    var min = env['min'].get();
    var max = env['max'].get();
    var x = Math.random() * (max - min) + min;
    return TwovilleReal.create(x);
  }
}

// --------------------------------------------------------------------------- 

var ExpressionInt = {
  create: function(parent) {
    return Object.create(ExpressionInt);
  },
  evaluate: function(env, fromTime, toTime) {
    var f = env['x'].get();
    var i = Math.trunc(f);
    return TwovilleInteger.create(i);
  }
}

// --------------------------------------------------------------------------- 

