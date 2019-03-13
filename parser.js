import {
  Tokens,
  SourceLocation
} from './token.js';

import {
  LocatedException,
  MessagedException,
} from './types.js';

import {
  ExpressionAdd,
  ExpressionAssignment,
  ExpressionBlock,
  ExpressionBoolean,
  ExpressionDivide,
  ExpressionFor,
  ExpressionFunctionCall,
  ExpressionIdentifier,
  ExpressionInteger,
  ExpressionMultiply,
  ExpressionProperty,
  ExpressionReal,
  ExpressionRemainder,
  ExpressionRepeat,
  ExpressionString,
  ExpressionSubtract,
  ExpressionVector,
  ExpressionWith,
  StatementTo,
  StatementThrough,
  StatementFrom,
  StatementBetween,
} from './ast.js';

export function parse(tokens) {
  let i = 0;
  let indents = [-1];

  function has(type, offset) {
    let index = i;
    if (offset) {
      index = i + offset;
    }

    if (index < 0 || index >= tokens.length) {
      return false;
    } else {
      return tokens[index].type == type;
    }
  }

  function consume() {
    i += 1;
    return tokens[i - 1];
  }

  function program() {
    let b = block();
    if (!has(Tokens.EOF)) {
      throw new LocatedException(b.where, 'I expected the program to end after this, but it didn\'t.');
    }
    return b;
  }

  function block() {
    if (!has(Tokens.Indentation)) {
      throw new LocatedException(tokens[i].where, 'I expected the code to be indented here, but it wasn\'t.');
    }

    let indentation = tokens[i];

    if (indentation.source.length <= indents[indents.length - 1]) {
      throw new LocatedException(indentation.where, 'I expected the indentation to increase upon entering a block.');
    }
    indents.push(indentation.source.length);

    let statements = [];
    while (has(Tokens.Indentation)) {
      if (tokens[i].source.length != indentation.source.length) {
        throw new LocatedException(tokens[i].where, 'I expected consistent indentation within a block, but this indentation jumps around.');
      }
      consume(); // eat indentation
      if (has(Tokens.Linebreak)) {
        consume();
      } else if (!has(Tokens.EOF)) {
        let s = statement();
        statements.push(s);
      }
    }

    indents.pop();

    let sourceStart = null;
    let sourceEnd = null;
    if (statements.length > 0) {
      sourceStart = statements[0].where;
      sourceEnd = statements[statements.length - 1].where;
    }

    return new ExpressionBlock(SourceLocation.span(sourceStart, sourceEnd), statements);
  }

  function statement() {
    if (has(Tokens.T)) {
      let firstT = tokens[i];
      consume();
      if (has(Tokens.RightArrow)) { // t ->
        consume();
        let e = expression();
        if (has(Tokens.Linebreak)) { // t -> 10
          consume();
          let b = block();
          return new StatementTo(SourceLocation.span(e.where, b.where), e, b);
        } else if (has(Tokens.RightArrow)) { // t -> 10 ->
          let arrow = tokens[i];
          consume();
          if (has(Tokens.T)) {
            let secondT = tokens[i];
            consume();
            if (has(Tokens.Linebreak)) {
              consume();
              let b = block();
              return new StatementThrough(SourceLocation.span(e.where, b.where), e, b);
            } else {
              throw new LocatedException(SourceLocation.span(firstT.where, secondT.where), 'I expected a linebreak after this time interval.');
            }
          } else {
            throw new LocatedException(SourceLocation.span(firstT.where, arrow.where), 'I expected a second t in this through-interval.');
          }
        } else {
          throw new LocatedException(SourceLocation.span(firstT.where, e.where), 'I expected either a to-interval or a through-interval, but that\'s not what I found.');
        }
      } else {
        throw new LocatedException(firstT.where, 'I expected either a to-interval or a through-interval, but that\'s not what I found.');
      }
    }
    
    // A statement that doesn't start with T.
    else {
      let e = expression();

      if (has(Tokens.RightArrow)) {
        let arrow = tokens[i].where;
        let from = e;
        consume();
        if (has(Tokens.T)) {
          let t = tokens[i];
          consume();
          if (has(Tokens.Linebreak)) { // 10 -> t
            consume();
            let b = block();
            return new StatementFrom(SourceLocation.span(from.where, b.where), from, b);
          } else if (has(Tokens.RightArrow)) { // 10 -> t -> 20
            consume();
            let to = expression();
            if (has(Tokens.Linebreak)) {
              consume();
              let b = block();
              return new StatementBetween(SourceLocation.span(from.where, b.where), from, to, b);
            } else {
              throw new LocatedException(SourceLocation.span(from.where, to.where), 'I expected either a line break after this interval.');
            }
          } else {
            throw new LocatedException(SourceLocation.span(e.where, t.where), 'I expected either a from-interval or a between-interval, but that\'s not what I found.');
          }
        } else {
          throw new LocatedException(SourceLocation.span(e.where, arrow.where), 'I expected either a from-interval or a between-interval, but that\'s not what I found.');
        }
      } else {
        if (has(Tokens.Linebreak)) {
          consume();
          return e;
        } else if (has(Tokens.EOF) || has(Tokens.Indentation)) { // Check for indentation because some expressions end in blocks, which have eaten their linebreak already
          return e;
        } else if (!has(Tokens.EOF)) {
          throw new LocatedException(tokens[i].where, 'I expected a line break or the end the program, but that\'s not what I found.');
        }
      }
    }
  }

  function expression() {
    return expressionAssignment();
  }

  function expressionAssignment() {
    let lhs = expressionAdditive(); 
    if (has(Tokens.Assign)) {
      consume();
      let rhs = expressionAssignment();
      lhs = new ExpressionAssignment(SourceLocation.span(lhs.where, rhs.where), lhs, rhs);
    }
    return lhs;
  }

  function expressionAdditive() {
    let a = expressionMultiplicative();
    while (has(Tokens.Plus) || has(Tokens.Minus)) {
      let operator = consume();
      let b = expressionMultiplicative();
      if (operator.type == Tokens.Plus) {
        a = new ExpressionAdd(SourceLocation.span(a.where, b.where), a, b);
      } else {
        a = new ExpressionSubtract(SourceLocation.span(a.where, b.where), a, b);
      }
    }
    return a;
  }

  function expressionMultiplicative() {
    let a = expressionProperty();
    while (has(Tokens.Asterisk) || has(Tokens.ForwardSlash) || has(Tokens.Percent)) {
      let operator = consume();
      let b = expressionProperty();
      if (operator.type == Tokens.Asterisk) {
        a = new ExpressionMultiply(SourceLocation.span(a.where, b.where), a, b);
      } else if (operator.type == Tokens.ForwardSlash) {
        a = new ExpressionDivide(SourceLocation.span(a.where, b.where), a, b);
      } else {
        a = new ExpressionRemainder(SourceLocation.span(a.where, b.where), a, b);
      }
    }
    return a;
  }

  function expressionProperty() {
    let base = atom();
    while (has(Tokens.Dot)) {
      consume(); 
      let property = atom();
      base = new ExpressionProperty(SourceLocation.span(base.where, property.where), base, property);
    }
    return base;
  }

  function isFirstOfExpression(offset = 0) {
    return has(Tokens.Integer, offset) ||
           has(Tokens.T, offset) ||
           has(Tokens.Boolean, offset) ||
           has(Tokens.String, offset) ||
           has(Tokens.Identifier, offset) ||
           has(Tokens.LeftSquareBracket, offset) ||
           has(Tokens.Repeat, offset) ||
           has(Tokens.For, offset);
  }

  function atom() {
    if (has(Tokens.Integer)) {
      let token = consume();
      return new ExpressionInteger(token.where, Number(token.source));
    } else if (has(Tokens.String)) {
      let token = consume();
      return new ExpressionString(token.where, token.source);
    } else if (has(Tokens.Real)) {
      let token = consume();
      return new ExpressionReal(token.where, Number(token.source));
    } else if (has(Tokens.Boolean)) {
      let token = consume();
      return new ExpressionBoolean(token.where, token.source == 'true');
    } else if (has(Tokens.For)) {
      let sourceStart = tokens[i].where;
      consume();
      if (isFirstOfExpression()) {
        let j = expression();
        if (has(Tokens.From) && isFirstOfExpression(1)) {
          consume();
          let start = expression();
          if (has(Tokens.To) && isFirstOfExpression(1)) {
            consume();
            let stop = expression();

            if (!has(Tokens.Linebreak)) {
              throw new LocatedException(SourceLocation.span(sourceStart, stop.where), 'I expected a linebreak after this loop\'s range.');
            }
            consume(); // eat linebreak
            let body = block();

            let by = new ExpressionInteger(null, 1);

            return new ExpressionFor(SourceLocation.span(sourceStart, body.where), j, start, stop, by, body);
          }
        }
      }
    } else if (has(Tokens.LeftSquareBracket)) {
      let sourceStart = tokens[i].where;
      consume(); // eat [
      let elements = [];
      while (!has(Tokens.RightSquareBracket)) {
        let e = expression();
        elements.push(e);
        if (!has(Tokens.RightSquareBracket)) {
          if (has(Tokens.Comma)) {
            consume(); // eat ,
          } else {
            throw new LocatedException(SourceLocation.span(e.where, tokens[i].where), 'I expected a comma between vector elements.');
          }
        }
      }
      let sourceEnd = tokens[i].where;
      consume(); // eat ]
      return new ExpressionVector(SourceLocation.span(sourceStart, sourceEnd), elements);
    } else if (has(Tokens.Identifier) && has(Tokens.LeftParenthesis, 1)) {
      let sourceStart = tokens[i].where;

      let name = consume().source;
      consume(); // eat (

      let actuals = [];
      if (isFirstOfExpression()) {
        actuals.push(expression());
        while (has(Tokens.Comma) && isFirstOfExpression(1)) {
          consume(); // eat ,
          actuals.push(expression());
        }
      }

      let sourceEnd = tokens[i].where;
      if (has(Tokens.RightParenthesis)) {
        consume();
      } else {
        throw new LocatedException(SourceLocation.span(sourceStart, sourceEnd), 'I expected a right parenthesis to close the function call.');
      }

      return new ExpressionFunctionCall(SourceLocation.span(sourceStart, sourceEnd), name, actuals);
    } else if (has(Tokens.Repeat)) {
      let sourceStart = tokens[i].where;
      consume(); // eat repeat
      let count = expression();
      if (!has(Tokens.Linebreak)) {
        throw new LocatedException(SourceLocation.span(sourceStart, count.where), 'I expected a linebreak after this repeat\'s count.');
      }
      consume(); // eat linebreak
      let body = block();
      return new ExpressionRepeat(SourceLocation.span(sourceStart, body.where), count, body);
    } else if (has(Tokens.Identifier) || has(Tokens.T)) {
      let where = tokens[i].where;
      let id = consume();
      return new ExpressionIdentifier(where, id);
    } else if (has(Tokens.With)) {
      let sourceStart = tokens[i].where;
      consume(); // eat with
      let scope = expression();
      if (!has(Tokens.Linebreak)) {
        throw new LocatedException(SourceLocation.span(sourceStart, scope.where), 'I expected a linebreak after this with statement\'s scope expression.');
      }
      consume(); // eat linebreak
      let body = block();
      return new ExpressionWith(SourceLocation.span(sourceStart, body.where), scope, body);
    } else {
      if (!has(Tokens.Linebreak)) {
        throw new LocatedException(tokens[i].where, `I don't know what "${tokens[i].source}" means here.`);
      }
    }
  }

  let ast = program();

  return ast;
}
