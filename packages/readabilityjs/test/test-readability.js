var JSDOM = require("jsdom").JSDOM;
var chai = require("chai");
var sinon = require("sinon");
const { parseHTML } = require("linkedom");

chai.config.includeStack = true;
var expect = chai.expect;

var Readability = require("../index").Readability;
var JSDOMParser = require("../JSDOMParser");
var prettyPrint = require("./utils").prettyPrint;

const isOmnivore = process.env.IS_OMNIVORE;
var testPages = require("./utils").getTestPages(isOmnivore);

function reformatError(err) {
  var formattedError = new Error(err.message);
  formattedError.stack = err.stack;
  return formattedError;
}

function inOrderTraverse(fromNode) {
  if (fromNode.firstChild) {
    return fromNode.firstChild;
  }
  while (fromNode && !fromNode.nextSibling) {
    fromNode = fromNode.parentNode;
  }
  return fromNode ? fromNode.nextSibling : null;
}

function inOrderIgnoreEmptyTextNodes(fromNode) {
  do {
    fromNode = inOrderTraverse(fromNode);
  } while (fromNode && fromNode.nodeType == 3 && !fromNode.textContent.trim());
  return fromNode;
}

function traverseDOM(callback, expectedDOM, actualDOM) {
  var actualNode = actualDOM.documentElement || actualDOM.childNodes[0];
  var expectedNode = expectedDOM.documentElement || expectedDOM.childNodes[0];
  while (actualNode || expectedNode) {
    // We'll stop if we don't have both actualNode and expectedNode
    if (!callback(actualNode, expectedNode)) {
      break;
    }
    actualNode = inOrderIgnoreEmptyTextNodes(actualNode);
    expectedNode = inOrderIgnoreEmptyTextNodes(expectedNode);
  }
}

// Collapse subsequent whitespace like HTML:
function htmlTransform(str) {
  return str.replace(/\s+/g, " ");
}

function runTestsWithItems(label, domGenerationFn, source, expectedContent, expectedMetadata, uri) {
  describe(label, function() {
    this.timeout(30000);

    var result;

    before(function() {
      try {
        var doc = domGenerationFn(source);
        // Provide one class name to preserve, which we know appears in a few
        // of the test documents.
        var myReader = new Readability(doc, { classesToPreserve: ["caption"], url: uri });
        result = myReader.parse();
      } catch (err) {
        throw reformatError(err);
      }
    });

    it("should return a result object", function() {
      expect(result).to.include.keys("content", "title", "excerpt", "byline");
    });

    it("should extract expected content", function() {
      function nodeStr(n) {
        if (!n) {
          return "(no node)";
        }
        if (n.nodeType == 3) {
          return "#text(" + htmlTransform(n.textContent) + ")";
        }
        if (n.nodeType != 1) {
          return "some other node type: " + n.nodeType + " with data " + n.data;
        }
        var rv = n.localName;
        if (n.id) {
          rv += "#" + n.id;
        }
        if (n.className) {
          rv += ".(" + n.className + ")";
        }
        return rv;
      }

      function genPath(node) {
        if (node.id) {
          return "#" + node.id;
        }
        if (node.tagName == "BODY") {
          return "body";
        }
        var parent = node.parentNode;
        var parentPath = genPath(parent);
        var index = Array.prototype.indexOf.call(parent.childNodes, node) + 1;
        return parentPath + " > " + nodeStr(node) + ":nth-child(" + index + ")";
      }

      function findableNodeDesc(node) {
        return genPath(node) + "(in: ``" + node.parentNode.innerHTML + "``)";
      }

      function attributesForNode(node) {
        return Array.from(node.attributes).map(function(attr) {
          return attr.name + "=" + attr.value;
        }).join(",");
      }


      var actualDOM = domGenerationFn(prettyPrint(result.content));
      var expectedDOM = domGenerationFn(prettyPrint(expectedContent));
      traverseDOM(function(actualNode, expectedNode) {
        if (actualNode && expectedNode) {
          var actualDesc = nodeStr(actualNode);
          var expectedDesc = nodeStr(expectedNode);
          if (actualDesc != expectedDesc) {
            expect(actualDesc, findableNodeDesc(actualNode)).eql(expectedDesc);
            return false;
          }
          // Compare text for text nodes:
          if (actualNode.nodeType == 3) {
            var actualText = htmlTransform(actualNode.textContent);
            var expectedText = htmlTransform(expectedNode.textContent);
            expect(actualText, findableNodeDesc(actualNode)).eql(expectedText);
            if (actualText != expectedText) {
              return false;
            }
          // Compare attributes for element nodes:
          } else if (actualNode.nodeType == 1) {
            var actualNodeDesc = attributesForNode(actualNode);
            var expectedNodeDesc = attributesForNode(expectedNode);
            var desc = "node " + nodeStr(actualNode) + " attributes (" + actualNodeDesc + ") should match (" + expectedNodeDesc + ") ";
            expect(actualNode.attributes.length, desc).eql(expectedNode.attributes.length);
            for (var i = 0; i < actualNode.attributes.length; i++) {
              var attr = actualNode.attributes[i].name;
              var actualValue = actualNode.getAttribute(attr);
              var expectedValue = expectedNode.getAttribute(attr);
              expect(expectedValue, "node (" + findableNodeDesc(actualNode) + ") attribute " + attr + " should match").eql(actualValue);
            }
          }
        } else {
          expect(nodeStr(actualNode), "Should have a node from both DOMs").eql(nodeStr(expectedNode));
          return false;
        }
        return true;
      }, actualDOM, expectedDOM);
    });

    it("should extract expected title", function() {
      expect(result.title).eql(expectedMetadata.title);
    });

    it("should extract expected byline", function() {
      expect(result.byline).eql(expectedMetadata.byline);
    });

    it("should extract expected excerpt", function() {
      expect(result.excerpt).eql(expectedMetadata.excerpt);
    });

    it("should extract expected site name", function() {
      expect(result.siteName).eql(expectedMetadata.siteName);
    });

    expectedMetadata.dir && it("should extract expected direction", function() {
      expect(result.dir).eql(expectedMetadata.dir);
    });
  });
}

function removeCommentNodesRecursively(node) {
  for (var i = node.childNodes.length - 1; i >= 0; i--) {
    var child = node.childNodes[i];
    if (child.nodeType === child.COMMENT_NODE) {
      node.removeChild(child);
    } else if (child.nodeType === child.ELEMENT_NODE) {
      removeCommentNodesRecursively(child);
    }
  }
}

describe("Readability API", function() {
  describe("#constructor", function() {
    var doc = new JSDOMParser().parse("<html><div>yo</div></html>");
    it("should accept a debug option", function() {
      expect(new Readability(doc)._debug).eql(false);
      expect(new Readability(doc, {debug: true})._debug).eql(true);
    });

    it("should accept a nbTopCandidates option", function() {
      expect(new Readability(doc)._nbTopCandidates).eql(5);
      expect(new Readability(doc, {nbTopCandidates: 42})._nbTopCandidates).eql(42);
    });

    it("should accept a maxElemsToParse option", function() {
      expect(new Readability(doc)._maxElemsToParse).eql(0);
      expect(new Readability(doc, {maxElemsToParse: 42})._maxElemsToParse).eql(42);
    });

    it("should accept a keepClasses option", function() {
      expect(new Readability(doc)._keepClasses).eql(false);
      expect(new Readability(doc, {keepClasses: true})._keepClasses).eql(true);
      expect(new Readability(doc, {keepClasses: false})._keepClasses).eql(false);
    });
  });

  describe("#parse", function() {
    var exampleSource = testPages[0].source;

    it("shouldn't parse oversized documents as per configuration", function() {
      var doc = new JSDOMParser().parse("<html><div>yo</div></html>");
      expect(function() {
        new Readability(doc, {maxElemsToParse: 1}).parse();
      }).to.Throw("Aborting parsing document; 2 elements found");
    });

    it("should run _cleanClasses with default configuration", function() {
      var doc = parseHTML(exampleSource).document;
      var parser = new Readability(doc);

      parser._cleanClasses = sinon.fake();

      parser.parse();

      expect(parser._cleanClasses.called).eql(true);
    });

    it("should run _cleanClasses when option keepClasses = false", function() {
      var doc = parseHTML(exampleSource).document;
      var parser = new Readability(doc, {keepClasses: false});

      parser._cleanClasses = sinon.fake();

      parser.parse();

      expect(parser._cleanClasses.called).eql(true);
    });

    it("shouldn't run _cleanClasses when option keepClasses = true", function() {
      var doc = parseHTML(exampleSource).document;
      var parser = new Readability(doc, {keepClasses: true});

      parser._cleanClasses = sinon.fake();

      parser.parse();

      expect(parser._cleanClasses.called).eql(false);
    });

    it("should use custom content serializer sent as option", function() {
      var dom = new JSDOM("My cat: <img src=''>");
      var expected_xhtml = "<div xmlns=\"http://www.w3.org/1999/xhtml\" id=\"readability-page-1\" class=\"page\">My cat: <img src=\"\" /></div>";
      var xml = new dom.window.XMLSerializer();
      var content = new Readability(dom.window.document, {
        serializer: function(el) {
          return xml.serializeToString(el.firstChild);
        }
      }).parse().content;
      expect(content).eql(expected_xhtml);
    });

    it("should not proxy image with data uri", function() {
      var dom = parseHTML("<html><body>My cat: <img src=\"data:image/png;base64, iVBORw0KGgoAAAANSUhEUgAAAAUA" +
        "AAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==\"" +
        " alt=\"Red dot\" /></body></html>");
      var expected_xhtml = "<DIV class=\"page\" id=\"readability-page-1\">My cat: <img src=\"data:image/png;base64," +
        " iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0" +
        "Y4OHwAAAABJRU5ErkJggg==\" alt=\"Red dot\"></DIV>";
      var content = new Readability(dom.document).parse().content;
      expect(content).eql(expected_xhtml);
    });

    it("should handle srcset elements with density descriptors", function() {
      var dom = parseHTML('<html><body>My image: <img src="https://webkit.org/demos/srcset/image-src.png" ' +
        'srcset="https://webkit.org/demos/srcset/image-1x.png 1x, ' +
        'https://webkit.org/demos/srcset/image-2x.png 2x, ' +
        'https://webkit.org/demos/srcset/image-3x.png 3x, ' +
        'https://webkit.org/demos/srcset/image-4x.png 4x">' +
        '</body></html>');
      var expected_xhtml = '<DIV class="page" id="readability-page-1">My image: ' +
                           '<img src="https://webkit.org/demos/srcset/image-src.png" ' +
                           'srcset="https://webkit.org/demos/srcset/image-1x.png 1x,' +
                           'https://webkit.org/demos/srcset/image-2x.png 2x,' +
                           'https://webkit.org/demos/srcset/image-3x.png 3x,' +
                           'https://webkit.org/demos/srcset/image-4x.png 4x,"></DIV>';
      var content = new Readability(dom.document, {
        createImageProxyUrl: function(url) {
          return url;
        }
      }).parse().content;
      expect(content).eql(expected_xhtml);
    });

    it("should remove srcset elements that are lazy loading placeholders", function() {
      var dom = parseHTML('<html><body>My image: <img class="shrinkToFit jetpack-lazy-image" src="https://i0.wp.com/cdn-images-1.medium.com/max/2000/1*rPXwIczUJRCE54v8FfAHGw.jpeg?resize=900%2C380&#038;ssl=1" alt width="900" height="380" data-recalc-dims="1" data-lazy-src="https://i0.wp.com/cdn-images-1.medium.com/max/2000/1*rPXwIczUJRCE54v8FfAHGw.jpeg?resize=900%2C380&amp;is-pending-load=1#038;ssl=1" srcset="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></body></html>');
      var expected_xhtml = '<DIV class="page" id="readability-page-1">' +
        'My image: <img src="https://i0.wp.com/cdn-images-1.medium.com/max/2000/1*rPXwIczUJRCE54v8FfAHGw.jpeg?resize=900%2C380&is-pending-load=1#038;ssl=1" alt="" width="900" height="380" data-recalc-dims="1" data-lazy-src="https://i0.wp.com/cdn-images-1.medium.com/max/2000/1*rPXwIczUJRCE54v8FfAHGw.jpeg?resize=900%2C380&is-pending-load=1#038;ssl=1">' +
        '</DIV>';
      var content = new Readability(dom.document, {
        createImageProxyUrl: function(url) {
          return url;
        }
      }).parse().content;
      expect(content).eql(expected_xhtml);
    });
  });
});

describe("Test pages", function() {
  testPages.forEach(function(testPage) {
    describe(testPage.dir, function() {
      var uri = "http://fakehost/test/page.html";

      runTestsWithItems("jsdom", function(source) {
        var doc =parseHTML(source).document;
        removeCommentNodesRecursively(doc);
        return doc;
      }, testPage.source, testPage.expectedContent, testPage.expectedMetadata, uri);

      // runTestsWithItems("JSDOMParser", function(source) {
      //   var parser = new JSDOMParser();
      //   var doc = parser.parse(source, uri);
      //   if (parser.errorState) {
      //     console.error("Parsing this DOM caused errors:", parser.errorState);
      //     return null;
      //   }
      //   return doc;
      // }, testPage.source, testPage.expectedContent, testPage.expectedMetadata);
    });
  });
});
