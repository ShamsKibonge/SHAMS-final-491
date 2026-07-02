const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

const filePath = 'frontend/src/App.js';
const source = fs.readFileSync(filePath, 'utf8');

const ast = parser.parse(source, {
  sourceType: 'module',
  plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'],
});

function isRuntimeImport(node) {
  return (
    t.isImportDeclaration(node) &&
    node.source.value === 'react/jsx-runtime'
  );
}

function isJsxRuntimeCall(node) {
  return (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee) &&
    (node.callee.name === '_jsx' || node.callee.name === '_jsxs')
  );
}

function propNameToAttributeName(name) {
  return t.jsxIdentifier(name);
}

function valueToAttributeValue(value) {
  if (t.isStringLiteral(value)) {
    return t.stringLiteral(value.value);
  }

  if (t.isBooleanLiteral(value) && value.value === true) {
    return null;
  }

  return t.jsxExpressionContainer(value);
}

function expressionToChild(value) {
  if (t.isStringLiteral(value)) {
    return t.jsxText(value.value);
  }

  if (t.isNullLiteral(value)) {
    return t.jsxExpressionContainer(value);
  }

  if (isJsxRuntimeCall(value)) {
    return runtimeCallToJsx(value);
  }

  return t.jsxExpressionContainer(value);
}

function buildChildren(childrenValue) {
  if (!childrenValue) {
    return [];
  }

  if (t.isArrayExpression(childrenValue)) {
    return childrenValue.elements
      .filter(Boolean)
      .map((child) => expressionToChild(child));
  }

  return [expressionToChild(childrenValue)];
}

function runtimeCallToJsx(node) {
  const [typeArg, propsArg, keyArg] = node.arguments;
  if (!typeArg || !propsArg || !t.isObjectExpression(propsArg)) {
    return node;
  }

  const isFragment =
    t.isIdentifier(typeArg, { name: '_Fragment' }) ||
    t.isMemberExpression(typeArg);

  const openingName = isFragment
    ? null
    : t.isStringLiteral(typeArg)
      ? t.jsxIdentifier(typeArg.value)
      : t.jsxIdentifier(typeArg.name);

  const attributes = [];
  let childrenValue = null;

  for (const prop of propsArg.properties) {
    if (t.isSpreadElement(prop)) {
      attributes.push(t.jsxSpreadAttribute(prop.argument));
      continue;
    }

    const keyName = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;

    if (keyName === 'children') {
      childrenValue = prop.value;
      continue;
    }

    if (!keyName) {
      continue;
    }

    attributes.push(
      t.jsxAttribute(
        propNameToAttributeName(keyName),
        valueToAttributeValue(prop.value)
      )
    );
  }

  if (keyArg) {
    attributes.push(
      t.jsxAttribute(t.jsxIdentifier('key'), valueToAttributeValue(keyArg))
    );
  }

  const children = buildChildren(childrenValue);

  if (isFragment) {
    return t.jsxFragment(
      t.jsxOpeningFragment(),
      t.jsxClosingFragment(),
      children
    );
  }

  return t.jsxElement(
    t.jsxOpeningElement(openingName, attributes, children.length === 0),
    children.length === 0 ? null : t.jsxClosingElement(openingName),
    children
  );
}

traverse(ast, {
  ImportDeclaration(path) {
    if (isRuntimeImport(path.node)) {
      path.remove();
    }
  },
  CallExpression(path) {
    if (isJsxRuntimeCall(path.node)) {
      path.replaceWith(runtimeCallToJsx(path.node));
    }
  },
});

const output = generate(ast, {
  jsescOption: { minimal: false },
  retainLines: false,
}, source).code;

fs.writeFileSync(filePath, `${output}\n`);
