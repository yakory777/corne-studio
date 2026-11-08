if(CONFIG_CORNE_TOOL)
  target_sources(app PRIVATE src/proto.c)
  target_sources_ifdef(CONFIG_CORNE_TOOL_DISPLAY app PRIVATE src/screen.c)
endif()
