(function () {

(function () {

///////////////////////////////////////////////////////////////////////////////////////////
//                                                                                       //
// plugin/compile-coffeescript.js                                                        //
//                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////
                                                                                         //
var fs = Npm.require('fs');                                                              // 1
var path = Npm.require('path');                                                          // 2
var coffee = Npm.require('coffee-script');                                               // 3
var _ = Npm.require('underscore');                                                       // 4
var sourcemap = Npm.require('source-map');                                               // 5
                                                                                         // 6
var stripExportedVars = function (source, exports) {                                     // 7
  if (!exports || _.isEmpty(exports))                                                    // 8
    return source;                                                                       // 9
  var lines = source.split("\n");                                                        // 10
                                                                                         // 11
  // We make the following assumptions, based on the output of CoffeeScript              // 12
  // 1.7.1.                                                                              // 13
  //   - The var declaration in question is not indented and is the first such           // 14
  //     var declaration.  (CoffeeScript only produces one var line at each              // 15
  //     scope and there's only one top-level scope.)  All relevant variables            // 16
  //     are actually on this line.                                                      // 17
  //   - The user hasn't used a ###-comment containing a line that looks like            // 18
  //     a var line, to produce something like                                           // 19
  //        /* bla                                                                       // 20
  //        var foo;                                                                     // 21
  //        */                                                                           // 22
  //     before an actual var line.  (ie, we do NOT attempt to figure out if             // 23
  //     we're inside a /**/ comment, which is produced by ### comments.)                // 24
  //   - The var in question is not assigned to in the declaration, nor are any          // 25
  //     other vars on this line. (CoffeeScript does produce some assignments            // 26
  //     but only for internal helpers generated by CoffeeScript, and they end           // 27
  //     up on subsequent lines.)                                                        // 28
  // XXX relax these assumptions by doing actual JS parsing (eg with jsparse).           // 29
  //     I'd do this now, but there's no easy way to "unparse" a jsparse AST.            // 30
  //     Or alternatively, hack the compiler to allow us to specify unbound              // 31
  //     symbols directly.                                                               // 32
                                                                                         // 33
  for (var i = 0; i < lines.length; i++) {                                               // 34
    var line = lines[i];                                                                 // 35
    var match = /^var (.+)([,;])$/.exec(line);                                           // 36
    if (!match)                                                                          // 37
      continue;                                                                          // 38
                                                                                         // 39
    // If there's an assignment on this line, we assume that there are ONLY              // 40
    // assignments and that the var we are looking for is not declared. (Part            // 41
    // of our strong assumption about the layout of this code.)                          // 42
    if (match[1].indexOf('=') !== -1)                                                    // 43
      continue;                                                                          // 44
                                                                                         // 45
    // We want to replace the line with something no shorter, so that all                // 46
    // records in the source map continue to point at valid                              // 47
    // characters.                                                                       // 48
    var replaceLine = function (x) {                                                     // 49
      if (x.length >= lines[i].length) {                                                 // 50
        lines[i] = x;                                                                    // 51
      } else {                                                                           // 52
        lines[i] = x + new Array(1 + (lines[i].length - x.length)).join(' ');            // 53
      }                                                                                  // 54
    };                                                                                   // 55
                                                                                         // 56
    var vars = match[1].split(', ');                                                     // 57
    vars = _.difference(vars, exports);                                                  // 58
    if (!_.isEmpty(vars)) {                                                              // 59
      replaceLine("var " + vars.join(', ') + match[2]);                                  // 60
    } else {                                                                             // 61
      // We got rid of all the vars on this line. Drop the whole line if this            // 62
      // didn't continue to the next line, otherwise keep just the 'var '.               // 63
      if (match[2] === ';')                                                              // 64
        replaceLine('');                                                                 // 65
      else                                                                               // 66
        replaceLine('var');                                                              // 67
    }                                                                                    // 68
    break;                                                                               // 69
  }                                                                                      // 70
                                                                                         // 71
  return lines.join('\n');                                                               // 72
};                                                                                       // 73
                                                                                         // 74
var addSharedHeader = function (source, sourceMap) {                                     // 75
  var sourceMapJSON = JSON.parse(sourceMap);                                             // 76
                                                                                         // 77
  // We want the symbol "share" to be visible to all CoffeeScript files in the           // 78
  // package (and shared between them), but not visible to JavaScript                    // 79
  // files. (That's because we don't want to introduce two competing ways to             // 80
  // make package-local variables into JS ("share" vs assigning to non-var               // 81
  // variables).) The following hack accomplishes that: "__coffeescriptShare"            // 82
  // will be visible at the package level and "share" at the file level.  This           // 83
  // should work both in "package" mode where __coffeescriptShare will be added          // 84
  // as a var in the package closure, and in "app" mode where it will end up as          // 85
  // a global.                                                                           // 86
  //                                                                                     // 87
  // This ends in a newline to make the source map easier to adjust.                     // 88
  var header = ("__coffeescriptShare = typeof __coffeescriptShare === 'object' " +       // 89
                "? __coffeescriptShare : {}; " +                                         // 90
                "var share = __coffeescriptShare;\n");                                   // 91
                                                                                         // 92
  // If the file begins with "use strict", we need to keep that as the first             // 93
  // statement.                                                                          // 94
  source = source.replace(/^(?:((['"])use strict\2;)\n)?/, function (match, useStrict) { // 95
    if (match) {                                                                         // 96
      // There's a "use strict"; we keep this as the first statement and insert          // 97
      // our header at the end of the line that it's on. This doesn't change             // 98
      // line numbers or the part of the line that previous may have been                // 99
      // annotated, so we don't need to update the source map.                           // 100
      return useStrict + "  " + header;                                                  // 101
    } else {                                                                             // 102
      // There's no use strict, so we can just add the header at the very                // 103
      // beginning. This adds a line to the file, so we update the source map to         // 104
      // add a single un-annotated line to the beginning.                                // 105
      sourceMapJSON.mappings = ";" + sourceMapJSON.mappings;                             // 106
      return header;                                                                     // 107
    }                                                                                    // 108
  });                                                                                    // 109
  return {                                                                               // 110
    source: source,                                                                      // 111
    sourceMap: JSON.stringify(sourceMapJSON)                                             // 112
  };                                                                                     // 113
};                                                                                       // 114
                                                                                         // 115
var handler = function (compileStep, isLiterate) {                                       // 116
  var source = compileStep.read().toString('utf8');                                      // 117
  var outputFile = compileStep.inputPath + ".js";                                        // 118
                                                                                         // 119
  var options = {                                                                        // 120
    bare: true,                                                                          // 121
    filename: compileStep.inputPath,                                                     // 122
    literate: !!isLiterate,                                                              // 123
    // Return a source map.                                                              // 124
    sourceMap: true,                                                                     // 125
    // Include the original source in the source map (sourcesContent field).             // 126
    inline: true,                                                                        // 127
    // This becomes the "file" field of the source map.                                  // 128
    generatedFile: "/" + outputFile,                                                     // 129
    // This becomes the "sources" field of the source map.                               // 130
    sourceFiles: [compileStep.pathForSourceMap]                                          // 131
  };                                                                                     // 132
                                                                                         // 133
  try {                                                                                  // 134
    var output = coffee.compile(source, options);                                        // 135
  } catch (e) {                                                                          // 136
    // XXX better error handling, once the Plugin interface support it                   // 137
    throw new Error(                                                                     // 138
      compileStep.inputPath + ':' +                                                      // 139
      (e.location ? (e.location.first_line + ': ') : ' ') +                              // 140
      e.message                                                                          // 141
    );                                                                                   // 142
  }                                                                                      // 143
                                                                                         // 144
  var stripped = stripExportedVars(output.js, compileStep.declaredExports);              // 145
  var sourceWithMap = addSharedHeader(stripped, output.v3SourceMap);                     // 146
                                                                                         // 147
  compileStep.addJavaScript({                                                            // 148
    path: outputFile,                                                                    // 149
    sourcePath: compileStep.inputPath,                                                   // 150
    data: sourceWithMap.source,                                                          // 151
    sourceMap: sourceWithMap.sourceMap,                                                  // 152
    bare: compileStep.fileOptions.bare                                                   // 153
  });                                                                                    // 154
};                                                                                       // 155
                                                                                         // 156
var literateHandler = function (compileStep) {                                           // 157
  return handler(compileStep, true);                                                     // 158
};                                                                                       // 159
                                                                                         // 160
Plugin.registerSourceHandler("coffee", handler);                                         // 161
Plugin.registerSourceHandler("litcoffee", literateHandler);                              // 162
Plugin.registerSourceHandler("coffee.md", literateHandler);                              // 163
                                                                                         // 164
///////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.compileCoffeescript = {};

})();

//# sourceMappingURL=compileCoffeescript_plugin.js.map